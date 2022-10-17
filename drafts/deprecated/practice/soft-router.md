---
title: Soft Router as Transparent VPN
date: 2017-04-16 14:07:11
tags:
    - net
    - practice
    - long
---

This post will cover how to configure a Linux computer to a router.

The router will be able to provide a transparent network to its clients.
Transparent means it could distinguish whether the connection needs forwarding to come across the GFW or not intelligently, which provides flawless experience to users in mainland china.

It frees the manual operations (like turn off the VPN) when you want to watch YOUKU just after watching Youtube.

<!-- more -->

## Prerequisite

1. some hardware with two or more network interfaces
1. a shadowsocks server, which can be easily deployed in VPS (Linode, Digital Ocean, etc)

## Feature

1. 

## method

1. configure linux kernel to provide ipv4 packet forwarding
1. use `iptables` to provide NAT and other things
1. use `dnsmasq` to provide DHCP and dns cache
1. use `ss-local`(listen on 60001, 60000) and `redsocks`(61000 -> 12345) to provide local shadowsocks proxy
1. use `haproxy` (60001, 60000 -> |load balance| 61000 )
1. use `overture` to provide clean dns resolution

## network configuration

Please ensure that you have more than two network interfaces working. You may use `ifconfig` to check.
You may pick two network interfaces, and decide which is the one connected to Internet(WAN), so the left one is connected to clients of this router.

For me, `ens32` is WAN port, `ens33` is LAN port.

Then, we should configure the LAN port to static IP, which is required by using it as gateway and dns server.
For debian like system, the configuration file is `/etc/network/interfaces`.
Mine:
```conf
auto ens32
iface ens32 inet dhcp

auto ens33
iface ens33 inet static
    address 10.0.0.2
    netmask 255.255.0.0
    nameserver 10.0.0.2
```

## clean DNS
`overture` is a dns server written by Go, [Github Link](https://github.com/shawn1m/overture/).

Download a release of your ISA, and extract the binary to `/usr/local/bin`, and copy other config files to `/etc/overture`.
For me, the config file is 
```conf
{
  "BindAddress": "127.0.0.1:5454",
  "PrimaryDNS": [
    {
      "Name": "114DNS",
      "Address": "114.114.114.114:53",
      "Protocol": "udp",
      "SOCKS5Address": "",
      "Timeout": 3,
      "EDNSClientSubnet": {
        "Policy": "disable",
        "ExternalIP": ""
      }
    }
  ],
  "AlternativeDNS": [
    {
      "Name": "GoogleDNS",
      "Address": "8.8.8.8:53",
      "Protocol": "tcp",
      "SOCKS5Address": "$SS_LOCAL_ADDRESS",
      "Timeout": 3,
      "EDNSClientSubnet": {
        "Policy": "disable",
        "ExternalIP": ""
      }
    }
  ],
  "OnlyPrimaryDNS": false,
  "RedirectIPv6Record": false,
  "IPNetworkFile": "../chinaip/chnroute.txt",
  "DomainFile": "./domain_sample",
  "DomainBase64Decode": true,
  "HostsFile": "./hosts_sample",
  "MinimumTTL": 0,
  "CacheSize" : 0,
  "RejectQtype": [255]
}
```

You may test it by `dig @127.0.0.1 -p 5454 www.facebook.com`.

## `dnsmasq`

First install it, for debian like system, `sudo apt install dnsmasq`.
Then edit `/etc/dnsmasq.conf` like that:

```conf
strict-order
no-resolv
no-poll

server=127.0.0.1#5454

interface=ens33
listen-address=127.0.0.1,10.0.0.2

dhcp-range=10.0.0.20,10.0.254.254,255.255.0.0,168h
dhcp-option=3,10.0.0.2

cache-size=15000
```

## packet forward

Add a line in the bottom of `/etc/sysctl.conf`, `net.ipv4.ip_forward=1`, then execute `sysctl -p`.
Then edit a `netcard.forward.sh`.
```bash
EXTIF="ens32"
INTIF="ens33"
iptables -t nat -A POSTROUTING -o $EXTIF -j MASQUERADE
iptables -A FORWARD -i $EXTIF -o $INTIF -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i $INTIF -o $EXTIF -j ACCEPT
```

## local shadowsocks proxy

I use `ss-redir`, so you first need to install `ss-redir`.
Then try to get it run, forward to local port `12345`.

## shadowsocks forward

### get china ip list
```sh
curl 'http://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-latest' \
    | grep ipv4 \
    | grep CN \
    | awk -F\| '{ printf("%s/%d\n", $4, 32-log($5)/log(2)) }' > chnroute.txt
```
### forward

```sh
SS_SERVER_IP='xxx.xxx.xxx.xxx'

iptables -t nat -N SHADOWSOCKS

iptables -t nat -A SHADOWSOCKS -d $SS_SERVER_IP -j RETURN

# lan
iptables -t nat -A SHADOWSOCKS -d 0.0.0.0/8 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 10.0.0.0/8 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 127.0.0.0/8 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 169.254.0.0/16 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 172.16.0.0/12 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 192.168.0.0/16 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 224.0.0.0/4 -j RETURN
iptables -t nat -A SHADOWSOCKS -d 240.0.0.0/4 -j RETURN

# china
cat chnroute.txt | xargs -I^ iptables -t nat -A SHADOWSOCKS -d '^' -j RETURN

iptables -t nat -A SHADOWSOCKS -p tcp -j REDIRECT --to-ports 12345
iptables -t nat -I PREROUTING -p tcp -j SHADOWSOCKS
```

## Save Iptables and Autostart

```sh
apt-get install iptables-persistent
iptables-save > /etc/iptables/rules.v4
```

There are many ways to autostart `ss-redir` and `overture`, so just pick one you like.

## other things

1. practice in vmware / virtual box is strongly recommended
2. running in vmware esxi is easy to deploy as there is built-in vSwitch
3. if works, welcome to internet

## 2018.2.8 update

1. x86 linux is stable enough, my thinkpad x200 runs without a hang for over 30 days
2. raspberry pi is not the best device as latency is too high (may up to several hundred ms) due to limited cpu performance
