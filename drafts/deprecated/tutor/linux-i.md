---
title: Linux入门 - 安装与使用
date: 2018-06-01 14:04:28
tags:
    - linux
    - tutor
    - long
---

# 前言

这是**Linux入门**的第一篇，目前我的计划是介绍：安装与使用、文件系统、BASH编程基础、定时任务、包管理器。

写这份笔记的原因在于，我能找到的书/博文并不能令我满意；而且同时也可以相对系统地整理自己关于Linux的知识与实践。它适合计算机专业低年级学生、想尝试Linux的玩家、兼职运维（比如不太了解Linux的全栈）来阅读。因此它不是：

- Linux参考手册
- Linux内核讲解
- Linux程序开发指南

你在这个链接可以下载到整个系列的PDF文档：[TODO]。

这个笔记使用CC-BY-NC-ND授权；西部的孩子们比我更缺钱，如果你觉得很有帮助，请给[希望小学计划](http://www.cydf.org.cn/donatedetail/?donateid=85)捐一些钱。

<!-- more -->

# 安装与使用

## 历史简介

20世纪60年代，MIT/GE/BELL开始了Multics项目。

20世纪70年代，Unix在Multics的基础上由Ken Thompson[^KT]开始开发；1973年正式诞生。Unix使用C语言开发。

Unix有两个重要的概念：
- 一切皆文件（描述符）；everything is a file (descriptor)
- 只做一件事，做好一件事；do one thing and do it well

1977年，BSD由Bill Joy[^BJ]开发完成。

1984年，GNU计划开始，FSF基金会成立。

GNU开发的软件包括`Emacs`，`GCC`，`glibc`，`bash`等。

1991年，Linux正式为人所知；linux最初的开发目标是在x86上运行的unix-like操作系统。当时正值AT&T与BSD就Unix代码版权打官司期间，BSD的发展变慢了。

![Unix时间线](../../uploads/pic/tutor-linux/historyofunix.png)

## 发行版

由于Linux仅包含内核和基本的工具（比如bash shell），为了让更多的人使用上Linux，商业公司/非盈利组织将Linux内核与可用软件、文档等打包起来，使其便于使用；我们称这种打包好的东西为**发行版**。

各种Linux发行版至少有以下共同点：

- 使用Linux内核；[Linux Kernel Archives](https://www.kernel.org/)
- 遵循[Filesystem Hierarchy Standard](http://www.pathname.com/fhs/)
- 遵循[Linux Standard Base](https://wiki.linuxfoundation.org/lsb/start)

<!-- TODO -->

常见的Linux发行版包括：

- RHEL
- CentOS
- Fedora
- SUSE
- Debian
- Ubuntu
- Arch
- Gentoo

## 安装

### 云

这是我最推荐的体验Linux的方式。它的优点在于：

1. 安装和销毁都十分的简单，不影响现有的计算机。
2. 所需要的前置知识最少；通常，源已经配置好。

关于在阿里云上配置一个使用Ubuntu的ECS的方法，参考[这篇文章TODO]()。

### 树莓派

树莓派是一个嵌入式的Linux开发板，如何组装它并且给它安装系统在[这篇文章TODO]()中有介绍。

### 虚拟机安装

这里将使用[VirtualBoxTODO]()作为示范。但是，我更加建议使用[Hyper-VTODO]()或者[VMware Workstation PlayerTODO]()，前者Windows 8.1/10专业版自带，后者如果是个人用户则是免费软件；它们支持的功能更多、效率也更高。

### 本机安装

本机安装是最后一种需要掌握的Linux安装方法，因为你需要事先了解**文件系统**和如何使用自定义的启动设备。后者在[这篇文章](TODO)中有简单的介绍。

## 使用

如果你已经完成了上一节，那么在启动Terminal/SSH连接之后可能会是这样的样子：

```
_username@_devicename:~$ _
```
其中那个下划线会跳动。

### 第一个命令

### 快捷键

### `man`

## 关机

## 参考和拓展阅读

1. [Unix Timeline](http://www.unix.org/what_is_unix/history_timeline.html)
2. [Unix Wars](https://en.wikipedia.org/wiki/Unix_wars)

# 文件系统

# BASH编程基础

# 定时任务

# 包管理器

[^KT]: 1983年图灵奖得主。 
[^BJ]: Sun的联合创始人之一。