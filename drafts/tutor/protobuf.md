---
title: Learn Protocol Buffers
date: 2019-08-31 06:04:15
tags:
	- protobuf
	- tutor
    - short
---

Protocol buffers are machanism for **serializing and deserializing** structured data, and they are language-newtral, platform-newtural, and extensible.

<!-- more -->

## Why

How do we serialize and retrieve structrured data?

- Raw in-memory? Fragile. memory layout, endian, not extensible
- Encode to single string? Low expression ablity.
- XML, JSON, BSON?

With protocol buffers, you write a `.proto` description of the data structure you wish to store. From that, the protocol buffer compiler creates a class that implements automatic encoding and parsing of the protocol buffer data with an efficient binary format.

Importantly, the protocol buffer format supports the idea of extending the format over time in such a way that the code can still read data encoded with the old format.

## Defining a Protocol Format

`=1`, `=2` markers identify the unique *tag* that field uses in the binary encoding. Tag numbers 1-15 require one less byte to encode, comparing to higher numbers.

- required
- optional
- repeated

## Compiling a Protocol Buffer

## Ref

[Protocol Buffer Language Guide](https://developers.google.com/protocol-buffers/docs/proto)

[Protobuf 3 Language Guide](https://developers.google.com/protocol-buffers/docs/proto3)