---
title: Leetcode 1 - 100 Solutions
date: 2017-05-24 22:03:24
tags: [acm, leetcode, algorithm, long]
---

写一写Leetcode 1 - 100题。

总体感受：

1. 很多边界甚至不合法的输入都需要考虑，这也是Leetcode更加接近于现实开发而不是ACM-ICPC的原因。
2. 写得短比写得快更重要。
3. 短是优雅的一部分，但短并不代表着优雅；在Leetcode这种提交一个模块的地方，完全可以用分号隔开只交一行上去，因此比行数没有意义。

<!-- more -->

这片博客里出现的题目，代码可以在[这个GitHub仓库](https://github.com/HoboChen/hoboalgocode)中的leetcode子目录中找到。

## 1 - 10

### 1. Two Sum

一个无序数组$A$，要求 $A_i + A_j = T, i \neq j$ , $T$ 已知，求$i, j$。
可以做到 $O(n)$ 时间, $O(1)$ 空间。

### 2. Add Two Numbers

两个大整数，以链表形式存储，求和。

### ^3. Longest Substring Without Repeating Characters

求一个字符串无重复字符的最长子串。
两个指针i, j，j往后移动到子串S[i..j]不合法，将i移动到S[j]字母的下一个位置。
时间复杂度 $O(n)$ 。

### 4. Median of Two Sorted Arrays

给两个有序数组，求出两个数组合并后的中位数。
这个题是面某公司的原题。

#### 二分套二分
这个做法可能比较难写。
TODO

#### 二分答案
这是一个比较好写的方法，假设最后的答案为k，二分求出k在数组A, B的序号，那么显然k和两个序号的和满足二分性质。
二分答案的复杂度是常数，所以最后的复杂度是 $O(\log(m + n))$。

### 5. Longest Palindromic Substring

求最长回文子串。

#### $O(n^2)$ DP

比较暴力，记dp[i][j]为子串S[i..j]是不是回文串。

#### $O(n)$ Manacher
TODO

### 6. ZigZag Conversion
题目意思比较难懂。
感觉没有什么意思的一个题。

### 7. Reverse Integer
在我做这道题的时候，还没有"越界请输出0"这个提醒。:-)
考虑一下越界的情况即可AC。

### 8. String to Integer (atoi)
比较不好写，很多边界情况需要考虑。
TODO

### 9. Palindrome Number
判断一个整数是不是回文的。
注意负数都不是回文的。

### 10. Regular Expression Matching TODO
实现一个宽字符匹配，宽字符里面可能有`.`或者`*`。
DP,dp[i][j]代表子串A[0..i]和B[0..j]能否匹配。

### 12. Integer to Roman
给出一个1-3999的整数，将其转为罗马数字。
比较没有意思的一个题。

### 15. 3Sum

有一个数组A, 要求 $A_i + A_j + A_k = T$, T已知，求所有三元组$(A_i, A_j, A_k)$，三元组无序。

挺多种方法来做这一个题。
枚举i，后转化成2-Sum。$O(n^2)$时间，$O(1)$空间。
枚举i, j后在哈希表内查找是否有k。$O(n^2)$时间，$O(n^2)$空间。
枚举i, j后二分k，需要先排序。$O(n^2\log(n))$时间，$O(1)$空间。这个方法我TLE了。

### 17. Letter Combinations of a Phone Number
给出一个手机9键键盘的按键序列，求所有可能的英文字符串。
DFS即可。

### 19. Remove Nth Node From End of List

删除链表中一个元素。

### 20. Valid Parentheses

给出一个括号序列，有且仅有`(`, `{`和`[`。判断其是否合法。
使用栈即可。

### 21. Merge Two Sorted Lists

合并两个有序链表到一个链表。

### 23. Merge k Sorted Lists

合并k个有序链表到一个链表。
注意细节，某公司的面试题是这个的增强版。

### 24. Swap Nodes in Pairs

比较tricky的一个题，可以递归解决。

### 27. Remove Element

把数组内某种元素删去。
也比较没有意思。

### 31. Next Permutatio

调用一下next_permutation就好。
正常的写法TODO

### 36. Valid Sodoku

比较无聊，按照规则细心写就好。

### 37. Sodoku Solver

比较常规的写法就是dfs；炫技一点可能就是DLX（面试官可能不懂）。

### 39. Combination Sum

DFS一下就好。

### 40. Combination Sum II

DFS一下就好。

### 46. Permutations

给一个序列，求所有排列。
做法比较流氓，先排序后使用`next_permutation`。

### 47. Permutations II

我这道题的代码和46完全一样。

### 50. Pow(x, n)
实现一个快速幂。

### ^76. Minimum Window Substring
给两个串，S和T。
要求求出一个S的子串S[i..j]使T的每个字符都在子串中出现。

两个指针动态更新就好。
这道题写了很久。

### 93. Restore IP Addresses

给出一个字符串，往里面增加三个'.'使其变为一个合法的IPv4地址。
DFS即可，可以剪枝。
