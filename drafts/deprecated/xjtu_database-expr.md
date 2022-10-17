---
title: Use Ruby To Manipulate MariaDB
date: 2017-05-26 14:56:17
tags:
    - xjtu
    - expr
    - ruby
    - mariadb
    - short
---

I decided to use `ruby` to create table and insert data for the database expriment of xjtu.

Also, the code can be reused, which can be found at [GitHub](https://github.com/HoboChen/hobosqlbot).

<!-- more -->

## Set Environment
### Install MariaDB

```sh
sudo apt update
sudo apt install mariadb-server mariadb-client
```

### Install and Configure PHPmyadmin(Optional)

```sh
sudo apt install phpmyadmin
sudo apt-get install phpmyadmin php-mbstring php-gettext
# add "Include /etc/phpmyadmin/apache.conf" to /etc/apache2/apache2.conf
sudo /etc/init.d/apache2 restart
```

### Add User and Grant Previledges
First, login to `mariadb` shell.
`sudo mysql`, it is strange that it does not require any password, which is different to `mysql` and confusing.

```sql
create user hobochen;
set password for hobochen = password('_mypassword');
grant all on *.* to hobochen;
flush previledges;
```

## Create Database
```sh
mysql -uhobochen -p
```
Then type "_mypassword".
```
create database mydb;
```

## Use Ruby to Manipulate MariaDB

Ruby is my favourite dynamic programming language, so I decide to use it to make this experiment happier.

First install the requirements.

```sh
sudo apt install ruby2.3-dev
sudo gem install mysql2
```

### Connnect to DB

```ruby
require 'mysql2'

client = Mysql2::Client.new(
    :host     => '127.0.0.1',  # 主机
    :username => 'hobochen',   # 用户名
    :password => '',           # 密码
    :database => 'mydb',       # 数据库
    :encoding => 'utf8'        # 编码
    )

results = client.query("SELECT VERSION()")
results.each do |row|
  puts row
end
```

If it works, it will print the version of your `mysql`/`mariadb`.

### Add Tables
```ruby
def ParseCreateTable(column, tablename, primarykey = nil)
    ret = "create table #{tablename} (\n"
    b = 0
    column.each do |k, v| 
        if b == 0 
            ret = "#{ret}#{k} #{v}"
            b = 1
        else 
            ret = "#{ret},\n#{k} #{v}"
        end
    end
    if primarykey != nil
        primarykey.each do |key|
            ret = "#{ret},\nprimary key(#{key})"
        end
    end
    ret = ret + "\n);\n"
    return ret
end

student = {
    "s" => "char(20)",
    "sname" => "char(10)",
    "sex" => "char(10)",
    "bdate" => "date",
    "height" => "decimal(5,2)",
    "dorm" => "char(30)",
}
student_pkey = ["s"]
qstring = ParseCreateTable(student, "jsj46_s025", student_pkey)
# p qstring
client.query(qstring)

cclass = {
    "c" => "char(10)",
    "cname" => "char(20)",
    "period" => "smallint",
    "credit" => "smallint",
    "teacher" => "char(10)"
}
class_pkey = ["c"]
client.query(ParseCreateTable(cclass, "jsj46_c025", class_pkey))

grade = {
    "s" => "char(20)",
    "c" => "char(10)",
    "grade" => "decimal(3, 1)"
}
client.query(ParseCreateTable(grade, "jsj46_sc025"))
```

After that you can go to `phpmyadmin` to check(if installed).

### Insert Data

First I transform the table in the Word document to csv files.
The csv files stored in subdirectory data.

And then the ruby.
```ruby
def ParseInsert(tablename, col, val)
        ret = "insert into #{tablename} ("
        b = 0
        col.each do |c|
        if b == 0
            ret = "#{ret}#{c}"
            b = 1
        else 
            ret = "#{ret}, #{c}"
        end
        end
        ret = "#{ret}) values ("
    b = 0
    val.each do |v|
        if b == 0
            ret = "#{ret}'#{v}'"
            b = 1
        else 
            ret = "#{ret}, '#{v}'"
        end
        end
        return ret + ")"
end

studentcol = ["s", "sname", "sex", "bdate", "height", "dorm"]
classcol = ["c", "cname", "period", "credit", "teacher"]
sccol = ["s", "c", "grade"]

string = IO.readlines("data/s.csv")
string.each do |s|
    s = s.chomp
    col = s.split(',')
    q = ParseInsert("jsj46_s025", studentcol, col)
    client.query(q)
end

string = IO.readlines("data/c.csv")
string.each do |s|
    s = s.chomp
    col = s.split(',')
    q = ParseInsert("jsj46_c025", classcol, col)
    client.query(q)
end

string = IO.readlines("data/sc.csv")
string.each do |s|
    s = s.chomp
    col = s.split(',')
    q = ParseInsert("jsj46_sc025", sccol, col)
    client.query(q)
end

```