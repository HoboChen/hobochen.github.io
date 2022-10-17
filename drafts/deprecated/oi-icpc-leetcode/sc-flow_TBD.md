---
title: ACM-网络流(TBD)
date: 2016-08-19 05:38:08
tags:
	- acm
	- algorithm
	- long
---

这篇博客包含了一些常见`网络流`算法的介绍。

<!-- more -->

## 概述
基础:

最大流
最小割
最小费用最大流

进阶：
最大权闭合子图；可以转化到最小割
最大密度子图；最大权闭合子图+01规划
无源无汇带容量上下界的可行流；
无源无汇带容量上下界的最大流
无源无汇带容量上下界的最小流

 

## 最大流

[POJ3469 - Dual Core CPU](http://poj.org/problem?id=3469)

这一道题可以看出模板速度。

[POJ3281 - Dining](http://poj.org/problem?id=3281)

比较复杂的匹配问题。

建图的顺序是食物->牛->饮料；左右添加超级源和超级汇。

值得注意的是牛必须拆点以防止一头牛占有多个食物/饮料。

[SPOJ - Smart Network Administrator](http://www.spoj.com/problems/NETADMIN/en/)

比较简单的最大流问题，视每条不同颜色的线为流量1即可；二分一下上下界。

[SPOJ - Intergalactic Map](http://www.spoj.com/problems/IM/en/)

同样比较简单，拆点即可。

[网络流24题 - 搭配飞行员](http://cojs.tk/cogs/problem/problem.php?pid=14)

二分图最大匹配。

[网络流24题 - 魔术球问题](http://cojs.tk/cogs/problem/problem.php?pid=396)

一般图的最小路径覆盖；拆点后转化为点数减去二分图最大匹配；此题还需要二分答案。

[网络流24题 - 最小路径覆盖](http://cojs.tk/cogs/problem/problem.php?pid=728)

同上题。

[网络流24题 - 骑士共存](http://cojs.tk/cogs/problem/problem.php?pid=746)

二分图的最大独立集。独立集指集合内任两个点没有边相连。

最大独立集 + 最小顶点覆盖 = 顶点数， 且在二分图内最小顶点覆盖 = 最大匹配。

POJ 3469 - dinic

POJ3496 - isap

POJ3281

SPOJ - Smart Network Administrator

 

### 最小割

[HDU5457 - Hold Your Hand](http://acm.split.hdu.edu.cn/showproblem.php?pid=5457)

建两棵Trie树，一棵存前缀，一棵存后缀。之后将对应（即表示相同的数）的叶子节点连上，之后再对应的Trie树上修改花费。求最小割。

[SWERC - 2015 F](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5329)

解法和代码见[SWERC 2015](http://192217.space/2016/09/sc-nwerc-2015/)。

hdu5457 - dinic

 

### 最大权闭合子图

闭合子图的定义是经过子图内的所有边都只能到达子图内的点。

如果每个点的点权固定，那么存在一种选择方法是最大子图内的点权和最大；称为最大权闭合子图。

建图方法是负权点连汇，容量为权的绝对值；正权点连源；容量为权。原图中的任意一条有向边仍然为有向边，容量为正无穷。最终的答案为所有正的点权和减去新图的最小割。

[NOI2006 - 最大获利](http://www.lydsy.com/JudgeOnline/problem.php?id=1497)

最大权闭合子图简单题。

这个题如果理解成带点权/边权的求子图密度的话，复杂度可以降到n个点，n+m条边。转化的方法可以见集训队论文《最小割模型在信息学竞赛中的应用》。

亦可见下文。

[网络流24题 - 太空飞行计划](http://cojs.tk/cogs/problem/problem.php?pid=727)

 

NOI2006 - 最大获利

NOI2006 - 最大获利(300ms)

 

### 最大密度子图

在一张图内选择一个一个子图，使EV最大。

设最终的最大值为θ=EV；构造函数 f(θ)=E−θV，显然这个函数满足二分性质。

比较容易的想法是把边(u,v)看成点e1，之后将建立两条边(e1,v),(e1,u)，e1的点权为1，u,v的点权均为−θ。然后二分θ即可。

另有一个更优的做法；先将原问题拓展到一张图内边有边权，点有点权（可正可负），见uva7037-optimum。

更优的方法建图策略如下：

- 记du=∑(u,v)∈Ewe，U=2∑v∈V|pv|+∑e∈Ewe
- c(u, v) = we
- c(S, v) = U
- c(v, T) = U+2g−dv−2pv
- =>h(g) = nU−c[S,T]2

[UVA7037 - The Problem Needs 3D Arrays](https://icpcarchive.ecs.baylor.edu/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=5049)

[POJ3155 - Hard Life](http://poj.org/problem?id=3155)

最大密度子图输出方案，值得一提的是这道题我被卡了精度。

UVA-7037

uva7037 - optimum

POJ - 3155

 

 