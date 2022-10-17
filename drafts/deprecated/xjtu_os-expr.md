---
title: OS Experiment - Recompile Linux Kernel and Some Others
date: 2016-12-03 14:56:17
tags:
    - xjtu
    - expr
    - linux
    - long
---

There are too many expriments this semester.
As for OS, recompiling the Linux kernel is the very first job to do intending to add a new system function.  I managed it under Ubuntu 16.04, 4.4.0.
And then I finished writing a simulation of file management which implemented `mkdir`, `rmdir`, `touch`, `delete`, `cd`, `pwd` and so on.

<!-- more -->

## Recompile Kernel

### Preparation

First you need a VMware machine. There are many tutorials on the Internet. 
Then you need the source code of linux kernel and the tools to compile it.

```bash
apt-get source linux-image-$(uname -r)
sudo apt-get build-dep linux-image-$(uname -r)
```
After the above commands, you may see a folder, which name is `$(uname -r)`.

### Add a System Call

First, change dir to `/arch/x86/entry/syscalls`. Then add a new line at the end of the `syscal_64.tbl`. For me, i add `546 common newcall sys_newcall`.

Then, change dir to `/include/linux`, and add a newline like `asmlinkage long sys_newcall(int x);`.

Then, add `hobo_newcall.c` in `/kernel`.
```c
#include <linux/kernel.h>

asmlinkage long sys_newcall(int x) {
    printk("hobo square, answer is %d\n", x * x);
    return x * x;
}
```

Last, modify the `kernel/Makefile` to add `hobo_newcall.o`.

### Compile

Change dir to `$(uname -r)`, 

```bash
sudo fakeroot debian/rules clean
sudo fakeroot debian/rules binary-headers binary-generic binary-perarch
sudo fakeroot debian/rules binary
```

### Install New Kernel

```
sudo dpkg -i *.deb
sudo reboot
```

### Use The New Kernel

Write test.c like:
```c
#include <stdio.h>
#include <unistd.h>

int main() {

    printf("%ld\n", syscall(546, 10));  // 546 is the syscall number above
    return 0;
}
```

## Filesystem Simulation

The following code still needs some tests.

```cpp
#include <bits/stdc++.h>

using namespace std;

struct pwdnode {
    string name;
    string pwd;
    pwdnode *fa;
    set<pwdnode *> sons;
    map<string, pwdnode *> mm;
    set<string> files;

    pwdnode(string s) {
        name = s;
        fa = 0;
        mm.clear();
    }

    static pwdnode * newnode(string s = "") {
        return new pwdnode(s);
    }

    static pwdnode * newnode(pwdnode * fa, string s) {
        pwdnode * tmp = new pwdnode(s);
        tmp -> fa = fa; // Set Father
        tmp -> sons.insert(tmp);
        tmp -> mm["."] = tmp;
        tmp -> sons.insert(fa);
        tmp -> mm[".."] = fa;

        fa -> sons.insert(tmp); // Update Father Dir
        fa -> mm[s] = tmp;

        tmp -> pwd = fa -> pwd + s + "/"; // Update this PWD
        return tmp;
    }

    void ls() {
        cout << "Directories: \n";
        cout << "." << "\t" << ".." << "\t";
        for (auto t : sons) {
            if (t != fa && t != this)
                cout << t -> name << "\t";
        }
        cout << endl;
        cout << "Files: \n";
        for (auto t : files)
            cout << t << "\t";
        cout << endl;
    }

    void printpwd() {
        cout << pwd << endl;
    }

    void newfile(string s) { // TODO already has that file
        files.insert(s);
    }
};

pwdnode * root;
pwdnode * cur;

void init() {
    root = pwdnode::newnode("/");
    root -> pwd = "/";
    root -> sons.insert(root);
    root -> mm["."] = root;
}

int main() {
    init();
    cur = root;
    while (1) {
        cout << "hobo =v= ";
        string cmd;
        bool processed = 0;
        getline(cin, cmd);
        if (cmd == "exit") break;
        if (cmd.substr(0, 2) == "cd") {
            processed = 1;
            string t = cmd.substr(3, cmd.size() - 3);
            if (cur -> mm.find(t) == cur -> mm.end()) {
                cout << "no such dir or dir invalid" << endl;
                continue;
            }
            cur = cur -> mm[t];
        }
        if (cmd.substr(0, 2) == "ls") {
            cur -> ls();
        }
        if (cmd.substr(0, 3) == "pwd") {
            cur -> printpwd();
        }
        if (cmd.substr(0, 5) == "mkdir") {
            string t = cmd.substr(6, cmd.size() - 6);
            pwdnode::newnode(cur, t);
        }
        if (cmd.substr(0, 5) == "rmdir") {
            string t = cmd.substr(6, cmd.size() - 6);
            if (cur -> mm.find(t) == cur -> mm.end()) {
                cout << "No Such Folder" << endl;
                continue;
            }
            if (cur -> mm[t] -> sons.size() > 2) { // == 2 means . and ..
                cout << "Still Has Sub Folders!" << endl;
                continue;
            }
            cur -> sons.erase(cur -> mm[t]);
            delete cur -> mm[t];
            cur -> mm.erase(t);
        }
        if (cmd.substr(0, 6) == "create") {
            string t = cmd.substr(7, cmd.size() - 7);
            cur -> newfile(t);
        }
        if (cmd.substr(0, 6) == "delete") {
            string t = cmd.substr(7, cmd.size() - 7);
            if (cur -> files.find(t) != cur -> files.end()) {
                cur -> files.erase(cur -> files.find(t));
            }
            else cout << "No Such File!" << endl;
        }
    }
    return 0;
}

```
