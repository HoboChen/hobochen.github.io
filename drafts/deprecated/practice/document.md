---
title: 一种写文档的实践 - I
date: 2018-12-08 14:56:17
tag:
    - practice
    - long
---

> 世界观决定方法论。

# 所见即所得 与 所想即所得

纵观所有的写电子文档的工具、方法，可以分为两种，所见即所得与所想即所得。

所见即所得，即是使得编辑文字时在屏幕上直接呈现最终显示效果，如打印到纸张上的效果。第一个所见即所得的文字处理软件是1974年发布的**Bravo**，由Butle Lampson[^BL]和Charles Simonyi完成，运行在Xerox Alto上。所见即所得的实践`Microsoft Word`在除了特定领域几乎成了电子文档的标准。

所想即所得，即是在编辑的时候使用带标记语法的纯文本来描述电子文档，比如引用关系、字体字号等。
典型的代表即是1978年发布的**TeX**，主要由Donald Knuth[^DK]开发；**LaTeX**则基于**TeX**，由Leslie Lamport[^LL]开发；
在本文中，我们讨论**XeLaTeX**，同样基于**TeX**，但提供了非英文字符、PDF输出的支持。
**LaTeX**是科学出版领域的事实标准。

我尽量避免和Word忠实用户讨论LaTeX的优缺点，但是请想一想以下几个场景：

- 修改简历，简历使用空格来保证复杂的对齐
- 某个使用Git管理的项目使用Word来写文档，两个人在不同的分支上修改了这个文档，需要合并这些修改
- 需要自动化地从某个数据仓库或其他地方生成一个报告文档，报告中有图片、表格等

所见即所得与所想即所得这两种方法论的差异本质上是`文本`与`对象`的世界观差异，不过这里不展开。

# Markdown与Pandoc

显然，对于标记语法，语法复杂程度是学习成本/使用成本与语法表达能力的权衡；LaTeX选择了后者，而Markdown选择了前者。

Pandoc是一个能将文档在不同标记语法（如HTML, Markdown, Office Open XML, LaTeX等）之间转换的工具。

我的写文档实践（即本文和之后的数篇）将介绍如何在享受到MD语法的便捷的同时，能够提高MD语法的表达能力。

我使用的主要方法即是借助于Pandoc，在MD文档中直接使用LaTeX的语法，有一点像JSX做的事情（在JS中直接写HTML）。

# 方法

你需要安装XeLaTeX、Pandoc，并且有文本编辑器；同时，我假设你能看懂最基本的Makefile。

XeLaTeX在几乎所有的TeX发行版中都提供了，Pandoc可以在其[GitHub仓库](https://github.com/jgm/pandoc/releases)的Release页面下载到其支持的平台的二进制包，如果没有，由于其工作在Haskell上，所以几乎可以工作在任何平台上。

# 我们所需要的表达能力

- 页
- 表格
- 公式
- 图
- 特定排版

## 页

**页**的概念可以说是HTML和TeX这两种现代标记语言差别最不同的地方了，其取舍与适用场景这里并不展开，我假设你需要产出十分正式的文档，以至于需要打印出来。

传统的MD由于没有页的概念

## 表格

TODO

## 公式

确实，Mathjax可以做很多事情，但是仍然有一些公式、数学字体没有得到支持；具体可以参考：[Mathjax and LaTeX](http://docs.mathjax.org/en/latest/tex.html#environments)。

## 图

TODO

## 特定排版

TODO

# 给Pandoc添加新的块高亮描述

假设你创造了一种新的DSL，给其他MD渲染器加上其词法高亮可能是困难的；对于一个少见的语言也是如此，比如protobuf。

不过

# 参考

- [The TeX Family Tree](https://www.overleaf.com/learn/latex/Articles/The_TeX_family_tree:_LaTeX,_pdfTeX,_XeTeX,_LuaTeX_and_ConTeXt)
- [Xerox Alto wiki](https://en.wikipedia.org/wiki/Xerox_Alto)

[^BL]: 1992年图灵奖得主，GUI开创者，维基百科[链接](https://en.wikipedia.org/wiki/Butler_Lampson)。
[^DK]: 1978年图灵奖得主，TAOCP作者，维基百科[链接](https://en.wikipedia.org/wiki/Donald_Knuth)。
[^LL]: 2013年图灵奖得主，分布式系统领域奠基者，维基百科[链接](https://en.wikipedia.org/wiki/Leslie_Lamport)。
