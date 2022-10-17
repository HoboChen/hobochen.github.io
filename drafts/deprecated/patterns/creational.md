Maze problem: xxx.

## Abstract Factory

To provide an interface for creating families of related or dependent objects withour specifying their concrete classes.

Structure Pic

Pros:

1. It isolates clients from concrete classes, both for symbols and APIs.
2. Supporting new kinds of products is difficult, as modifing APIs of abstract product requires the change of all subclasses.

Implementations:

1. Factories as singletons.
2. If many product families are possible, the concrete factory can be implemented using the Prototype (117) pattern. Q?

Interviews uses the “Kit” suffix [Lin92] to denote AbstractFactory classes.

Related PatternsAbstractFactory classes are often implemented with factory methods (Factory Method (107)), but they can also be implemented using Prototype (117).A concrete factory is often a singleton (Singleton (127)).

```cpp

abstract class factory {

}

class alphaFactory : factory {

}

class betaFactory : factory {
    
}

product create(factory& f) {
    return product(f.create());
}

create(new alphaFactory());

```

## Builder

Separate the construction of a complex object from its representation so that the same construction process can create different representations.

So it should be easy to add a new conversion without modifying the reader.

### Related Patterns

Abstract Factory (87) is similar to Builder in that it too may construct complex objects. The primary difference is that the Builder pattern focuses on constructing a complex object step by step. Abstract Factory’s emphasis is on families of product objects (either simple or complex). Builder returns the product as a final step, but as far as the Abstract Factory pattern is concerned, the product gets returned immediately.

A Composite (163) is what the builder often builds.

## Factory Method

Intent
Define an interface for creating an object, but let subclasses decide which class to instantiate. Factory Method lets a class defer instantiation to subclasses.