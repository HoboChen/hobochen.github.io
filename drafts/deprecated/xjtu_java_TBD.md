---
title: Java Notes(TBD)
date: 2017-10-21 14:56:17
tags:
    - xjtu
    - java
    - long
---

这篇博客是我在准备XJTU的Java考试时的笔记。
Java课程在XJTU有两种；一是全校公选的Java，二是计算机系大四的专业选修。

这门课共有32个学时，28小时的课和8小时的上机。

This blog is the notes of Java when I get ready for examination the course of XJTU.
There are two kinds of Java courses in XJTU; one is optional and every student can enroll, the other is exclusive to computer science majored students but still optional.

This course includes 32 teaching hours; 28 in classroom, 8 in lab.

<!-- more -->

# 课程介绍

## 课程要求

- 了解Java语言特征及不同版本分类
- 掌握Java程序设计基础知识
- 掌握Java的面向对象编程技术
- 掌握图形用户接口及事件处理机制
- 掌握Java多线程编程及其应用
- 掌握网络编程基本知识
- 能够设计并完成一个较复杂的应用实例

## 主要内容

- Java语言特征
- Java语言语法基础
- 面向对象的特征
- 图形用户界面设计
- 异常
- 多线程
- Java输入/输出
- 网络编程

# Java概述

## Java特点

- 应当使用面向对象程序设计方法
- 应当允许同一程序在不同的计算机平台执行
- 应当包括内建的对计算机网络的支持
- 应当被设计成安全地执行远端代码
- 应当易于使用，并借鉴以前那些面向对象语言（如C++）的长处。

## How .java Runs

1. Source code (.java file)
2. javac: Lexical Analysis & Parsing + Type-checking -> Byte code (.class file)
3. JVM: Verification (essentially repeating static checks) + (Interpretation OR Compilation + Loading + Executing)

## Casting

- widening conversion
- narrowing conversion

# 面向对象

- Java仅仅支持单根继承
- 但是Java可以用接口变相实现多重继承


## 定义类的语法

```
[类的修饰符] class 类名 [extends 父类名] [implements 接口名]
```
类的修饰符：
- public: 公共类，可以被其他任何类所使用(无任何限制)
- 无修饰/默认: 仅能被同一个包中的其他类引用
- abstract: 抽象类，不能被实例化/即创建对象
- final: 不能被继承

## Package

Please refer to https://docs.oracle.com/javase/tutorial/java/package/index.html.

## 
公共权限－public 
能被所有类访问
默认权限(或称包权限)
只能被同一包中的类访问
私有权限－ private
只能被该类自身访问
保护权限－ protected
只能被同一包中的类、该类的子类*访问

* 指子类与父类不在同一个包中的情况

