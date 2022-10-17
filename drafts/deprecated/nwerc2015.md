---
title: NWERC 2015 题解
date: 2016-09-11 15:59:48
tags:
	- acm
	- algorithm
	- long
---

这篇博客是`2015年NWERC`的题解。

<!-- more -->

这套题比较简单。以及我这套题的部分标程代码无法在UVALive中得到AC，即使能在本地运行中通过全部数据。但是在cf gym中可以得到ac。

[A](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5324)

DFS即可，简单题。

[B](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5325)

2-SAT问题，首先枚举那三张牌；然后对每张牌在A/B手中视为0/1建图。

[C](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5326)

用类似于合并石子那样的做法，区间DP。

[D](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5327)

简单题。

[E](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5328)

也是一个DP。

[F](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5329)

网络流求最小割。

对于任何相邻的节点连双向边，流量为A；从源连接容量为B的单向边到所有低地；从所有高地连接容量为B的单向边到汇。

注意点在于初始不知道哪些点是要改变的，所有任何相邻节点都要连流量为A的边。

[G](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5330)

博弈论求SG函数。

[H](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5331)

数位DP。

[I](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5332)

比较难的一个后缀树/后缀自动机。目前还没有做出来。

[J](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5333)

判断点在凸包内。

值得一提的是点在多边形内的判断需要O(n)，而点在凸包内的判断只需要O(log(n))。