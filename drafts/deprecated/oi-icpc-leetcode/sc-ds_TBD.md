---
title: ACM-数据结构(TBD)
date: 2016-08-01 05:55:43
tags:
	- acm
	- algorithm
	- long
---

这篇博客包含了一些常见`数据结构`。
这篇博客中的std代码可以在[这个仓库](https://github.com/HoboChen/hoboojcode)中的datastructure中找到。

<!-- more -->

Because my english is so bad, this series of posts (ACM-*) will be written in Chinese.

基础：
堆
树状数组
线段树
ST表RMQ

进阶：
左偏树
斐波那契堆/二项堆
伸展树(Splay Tree)
树链剖分
动态树(Link Cut Tree)
加上可持久化的许多东西: 可持久化线段树etc

### 堆

堆是一种可以在$O(n)$内由有序数组建立，建立后单次插入需要$\log(2)$级复杂度维护；可以 $O(1)$维护最大值/最小值的东西。


### 树状数组与线段树

线段树可以在$\log (2)$解决区间最值/和的问题，并且可以区间加/置。

树状数组可以单点修改，并且可以查询区间和。
[HDU 1166](http://acm.hdu.edu.cn/showproblem.php?pid=1166), 单点修改，区间查询和。
[HDU 1556](http://acm.hdu.edu.cn/showproblem.php?pid=1566), 区间修改（仅加1），单点查询。
[HDU 1754](http://acm.hdu.edu.cn/showproblem.php?pid=1754), 单点修改（置），区间查询最值。
[POJ 3468](http://poj.org/problem?id=3468),区间加，区间查询最值。可以用树状数组/线段树来做。

### ST表RMQ

[POJ2019](http://poj.org/problem?id=2019), 二维RMQ，可以转换成一维去做。
[HDU5443](http://acm.hdu.edu.cn/showproblem.php?pid=5443)

### 左偏树

左偏树是一种可以在$ \log(n) $时间内将两个堆合并的数据结构。

当然二项堆/斐波那契堆也可以做到不多于log(n)的堆合并。

[HDU1512 - Monkey King](http://acm.hdu.edu.cn/showproblem.php?pid=1512) 

以及这道题的代码中给出了__pbds中二项堆/配对堆的时间对比。（以及一些__pbds中其他的数据结构）
并查集+左偏树。

### Splay - 伸展树

伸展树是一种典型的平衡二叉树。
伸展树最基本的操作的是splay(x, S)意思就是将在S树中的x旋到树根。

Splay支持以下基本操作：

- find(x, S) 查询x是否在S中，仿照普通BST找到x，后splay(x, S)
- insert(x, S) 插入一个新的树，后splay(x, S)
- delete(x, S) 在树中删除x，找到x，如果没有孩子或只有一个孩子则直接删除；否则向下找到后继y，用y替代x的位置，后执行splay(y, S)
- split(x, S) 先find(x, S)后左子树是一棵splay，右子树也是一棵splay
- join(S1, S2) 保证S1中最大元素小于S2中最小元素，找到最大元素（一直往右），后splay(x, S1); 然后S2的根连到S1根的右子位置

[POJ2761 - Feed the dogs](http://poj.org/problem?id=2761)

这道题的做法非常多，我是直接用了splay的做法
静态区间第k大。


### 树链剖分

树链剖分可以将树上的链/点映射到一维上，加上线段树/全局平衡树可以高效地解决许多问题。

[ZJOI2013 - 树的统计](http://www.lydsy.com/JudgeOnline/problem.php?id=1036)

单点修改树上节点。查询树上u->v链上的和/最值。

[HDU5452 - Minimum Cut](http://acm.hdu.edu.cn/showproblem.php?pid=5452)

这是一道图论题，但是我目前只会树链剖分的做法。
如果u,v之间存在图边，那么给u->v这条链上的所有边权+1。
查询树中边权最小值。
值得注意地是这道题不论是使用树状数组或是线段树做区间修改都会TLE，需要使用差分数列。

[POJ2763 - Housewife Wind](http://poj.org/problem?id=2763)

动态地修改树上边权，查询路径边权和。
和ZJOI2013 - 树的统计算在一起，树链剖分的两种常见操作（对点/边的动态修改进行维护）就全了。

TODO: 同步仓库里和这里的题解。