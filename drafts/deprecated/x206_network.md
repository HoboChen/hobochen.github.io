---
title: 西一楼A206机房的网络方案
date: 2017-05-08 16:23:13
tags:
    - linux
    - long
    - the Great Wall
---

这是一篇很长的文章，详细描述了机房的网络服务与其相关的部署、维护方法。
既是机房网络的`维护手册`，同时作为我在其部署、维护过程中的`学习笔记`；亦可作为`最佳实践`供网络条件相近或是需求相近的人参考。

这篇文章假定读者有`网络`、`Linux`的基础知识。

<!-- more -->

## 概述

### 资源

#### 在线
- Dell R720 `服务器`, 双 Xeon E5 2665 C2, 16 GB Ecc 内存, 两个600GB 10K硬盘, 四口 100/1000
- HP Z220 `工作站`, E3-1230 V2, 32GB ECC 内存, 256GB SSD, 三口 100/1000
- Raspberry Pi 3 `服务器`, BCM2837, 1GB内存, 64GB TF卡, 双口100
- Netgear GS308 `交换机`, 8口 10/100/1000自适应, 属于`hobochen`
- Asus AC-68U 路由器, 300/866Mbps, 用作`无线AP`, 属于`hobochen`
- HP P1108 `激光打印机`, 用于无线打印, `zccz14`捐助
- `VPS`, 位于美国西海岸, IP: 50.116.7.134, `hobochen`捐助
- 两个公网IP, `IP1`:202.117.15.243, `IP2`: 202.117.15.245
- `校内VPS`， `IP3`: 58.206.125.46

#### 已离线
- IBM X3650-M2 `服务器`, Xeon L5420, 4GB Ecc 内存, 无硬盘, 双口 100/1000
- IBM X3650-M2 `服务器`, 双 Xeon E5420, 16GB Ecc 内存, 四个146GB 15K硬盘, 双口 100/1000

#### 机房目前在线服务
- 无线网络, SSID: ACM-TEAM, DHCP分配地址，地址池10.0.0.100-10.0.254.254
- 透明互联网，所有目标地址非中国IP的TCP数据包由VPS转发
- VPN入口
- GitLab, 位于10.0.0.4
- 无线打印服务, 位于http://10.0.0.4:631/printers/HP-LaserJet-Professional-P1108

### 核心网络拓扑图

![图](/uploads/pic/001.png)


### GS308交换机接口说明
从左往右编号1-8。

|接口编号|设备|操作系统|静态IP|备注
|:--:     |:--: |:--:     |:-:|:--:|
|1|ThinkPad X200|Ubuntu 16.04.2 LTS|10.0.0.6|属于`hobochen`
|2| 空|-|-|-
|3|HP-Z220|Ubuntu 16.04.2 LTS|10.0.0.4|属于`hobochen`
|4|Raspberry Pi 3|Debian 8 | 10.0.0.9|属于`hobochen`
|5| 空|-|-|-
|6|Asus AC-68U|-|10.0.0.3|属于`hobochen`
|7| 空|-|-|-
|8|Dell R720|VMware EXSi 6||-

### 内网静态IP管理(TBD)

10.0.0.1-10.0.0.99为静态IP段。

注意：如无特殊需求，设备应当以DHCP方式获取IP。


## 重启网络方案

### 服务器配置

#### 网关(HP Z220)

- 两个网卡
    - 网卡ens32；202.117.15.245，是整个机房的国内流量出口
    - 网卡ens33；10.0.0.4，是子网10.0.0.0/16的网关，同时负责DHCP地址分配和DNS解析

### 所需权限

1. HP-Z220密码

状态：机房断电。

### 步骤
1. 打开Z220电源。
2. 打开交换机电源。
3. 打开Z220，确保服务全部启动。
    - `ss-redir`
    - `haproxy`
    - `iptables`
    - `overture`
    - `dnsmasq`


## 透明互联网

过程可以参考**soft-router**这篇日志。

### Shadowsocks负载均衡

由于校园网环境下限制了10Mbps的国际出口，所以使用`IP1-3`来负载均衡Shadowsocks转发。

使用`haproxy`来提供负载均衡功能。

master - slave模式。
master负责将TCP端口52222负载均衡到slave的23334端口。

slave 使用`socat`将23334端口转发到`VPS`的8087端口。

`haproxy`配置文件如下：

```
defaults
	mode	tcp

frontend ss-in
	bind *:52222
	default_backend ss-out
backend ss-out
	mode tcp
	balance   roundrobin
	option tcplog
    server s1 58.206.125.46:23334 weight 10 maxconn 20480 check inter 1500 rise 3 fall 3
	server s2 10.0.0.8:23334 weight 10 maxconn 20480 check inter 1500 rise 3 fall 3
	server s3 10.0.0.2:23334 weight 10 maxconn 20480 check inter 1500 rise 3 fall 3
```

### 性能优化

安装`haveged`, 运行。
编辑`/etc/sysctl.conf`，加入以下内容：
```
net.ipv4.ip_local_port_range = 1024 65535
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.ipv4.tcp_rmem=4096 87380 16777216
net.ipv4.tcp_wmem=4096 65536 16777216
net.ipv4.tcp_fin_timeout = 10
net.ipv4.tcp_tw_recycle = 1
net.ipv4.tcp_timestamps = 0
net.ipv4.tcp_window_scaling = 0
net.ipv4.tcp_sack = 0
net.core.netdev_max_backlog = 30000
net.ipv4.tcp_no_metrics_save=1
net.core.somaxconn = 4096
net.ipv4.tcp_syncookies = 0
net.ipv4.tcp_max_orphans = 262144
net.ipv4.tcp_max_syn_backlog = 262144
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 2
```

运行以下脚本，需要`root`权限。
```sh
/sbin/sysctl -p /etc/sysctl.conf
echo ulimit -HSn 65536 >> /etc/rc.local
ulimit -HSn 65536
```

## VPN

使用`softether`来提供VPN。
VPN运行在树莓派3上，虚拟HUB桥接到10.0.0.9。

目前VPN已经开放给所有ACM校队成员。

## GitLab

### 安装

```sh
curl https://packages.gitlab.com/gpg.key 2> /dev/null | sudo apt-key add - &>/dev/null
echo "deb https://mirrors.tuna.tsinghua.edu.cn/gitlab-ce/ubuntu xenial main" | sudo tee /etc/apt/sources.list.d/gitlab-ce.list
sudo apt-get update
sudo apt-get install gitlab-ce
```

### 迁移

```sh
gitlab-rake gitlab:backup:create RAILS_ENV=production
```
备份产生的文件位于`/var/opt/gitlab/backups`。

后`rsync`同步一下，后在新的服务器下：
```
gitlab-rake gitlab:backup:restore RAILS_ENV=production   BACKUP=$name
```
name是备份文件名，注意新旧服务器的版本必须完全一样。

### 优化内存占用

编辑`/etc/gitlab/gitlab.rb`。

```
unicorn['worker_processes'] = 2
unicorn['worker_timeout'] = 60
```

## 无线打印

```sh
sudo apt install cups
sudo apt install hplip
sudo hp-setup
```

## 网络维护日志

2017.5.12 更换IP，两个新的IP作MAC绑定。
2017.5.13 更换网络结构。
2017.5.15 获得1x账号，待启用。
2017.5.16 Z220停机升级内存至16GB。
