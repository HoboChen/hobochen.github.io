---
title: Leetcode 突击
date: 2017-09-20 22:03:24
tags: [leetcode, algorithm, long]
---

这篇文章是我在准备某家公司面试的时候做的Leetcode题目。

其中列出的题目代码可以在[这个GitHub仓库](https://github.com/HoboChen/hoboojcode)中的leetcode子目录中找到。

<!-- more -->

# 动态规划

## [121. Stock I](https://leetcode.com/problems/best-time-to-buy-and-sell-stock/)

给一个股票价格的时间序列，只允许买卖一次。

DP，记dp[i]为第i天能持有的最小成本（即0-i天内的最小值）。

DP需要$O(n)$，遍历也需要$O(n)$。

## [122. Stock II](https://leetcode.com/problems/best-time-to-buy-and-sell-stock-ii/description/)

输入和上一题一样，允许买卖任意多次。但是最多只允许一支股票在手上。

DP，记dp[i][0/1]为到了第i天持有/不持有的最大获利。最终答案一定是dp[n - 1][0]。

复杂度$O(n)$。

## [123. Stock III](https://leetcode.com/problems/best-time-to-buy-and-sell-stock-iii/description/)

输入和上一题一样，但是只允许买卖两次。

DP，记dp[i][0/1][0/1/2]为到了第i天当前持有/不持有且完成了0/1/2次买卖的最大获利。最终答案一定是max(dp[n - 1][0][i])。

复杂度$O(n)$。

## [188. Stock IV](https://leetcode.com/problems/best-time-to-buy-and-sell-stock-iv/description/)

一道DP好题，数据也造的不错（相比于leetcode其他题目）；能使我不使用滚动数组的代码MLE或在k>n的情况下$O(nk)$的做法TLE。

记dp[i][0/1][0..k]为到了第i天当前持有/不持有且完成了m次买卖的最大获利。最终答案一定在max(dp[n - 1][0][i])。

时间复杂度$O(nk)$；空间复杂度$O(k)$。

这道题可以优化到$O(n + k\log n)$。

## [152. 最大连乘积](https://leetcode.com/problems/maximum-product-subarray/description/)

和最大和的区别就是最后答案可能有两种转移。

# 链表

比较好的一篇博客：http://wuchong.me/blog/2014/03/25/interview-link-questions/。

## [237. 单向链表删元素](https://leetcode.com/problems/delete-node-in-a-linked-list/description/)

假装删除一下就好。

## [141. 单向链表是否有环](https://leetcode.com/problems/linked-list-cycle/description/)

两个指针fast和slow，fast每次前进两格，slow每次前进一格，如果fast和slow相遇则有环。

## [19. 单向链表删除倒数第m个节点](https://leetcode.com/problems/remove-nth-node-from-end-of-list/description/)

两个指针，fast先前进m格；之后fast和slow一起前进到fast到达链表尾部。

## [24. 单向链表两两翻转元素](https://leetcode.com/problems/swap-nodes-in-pairs/description/)

递归的方法去做。

## [206. 单向链表翻转](https://leetcode.com/problems/reverse-linked-list/description/)

迭代的做法：
设定三个指针，pre, cur, nxt。
递归的做法：
回溯之前拆除所有关系，回溯过程中添加指回去的指针。

# 二叉树

## [236. LCA问题](https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-tree/)

比较有意思的一个题。

比较常规的思路就是遍历一遍，重建一个棵带有fathor指针的树。然后DFS两次即可。

这个题的思路是从根往下依次假设是LCA。

## [450. BST删节点](https://leetcode.com/problems/delete-node-in-a-bst/description/)

这道题的代码还没有获得通过。

## [114. 拍扁BST](https://leetcode.com/problems/flatten-binary-tree-to-linked-list/)

这道题的代码还没有获得通过。

这道题居然是一个权限题。

## [285. BST删除中序后继节点](https://leetcode.com/problems/inorder-successor-in-bst/description/)

右儿子不空的话返回右子树的最左叶子节点；否则需要类似在二叉树中查找的做法。

这道题居然是一个权限题。

## 二叉树的序列化与反序列化

[297. Serialize and Deserialize Binary Tree]https://leetcode.com/problems/serialize-and-deserialize-binary-tree/description/)

这道题的代码还没有获得通过。

# 字符串

## [151. 单词反向](https://leetcode.com/problems/reverse-words-in-a-string/)

这道题的代码还没有获得通过。
