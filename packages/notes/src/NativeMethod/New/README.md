# new 操作都做了什么  

## 示例一
```javascript
function Person ( name ) {
    this.name = name;
}

Person.prototype.getName = function () {
    return this.name;
}

const nicholas = new Person( 'nicholas' );
console.log( nicholas );
```  

`new` 操作符被用来创建一个实例对象，后面是构造函数。其实构造函数就是一个普通的函数，如果和 `new` 配合使用，那么里面的 `this` 就指向生成的实例对象，而如果直接调用，那么 `this` 就指向调用者（ 谁调用就指向谁 ）。  
打印 `nicholas` 发现它是这样的    

![nicholas打印结果]( https://github.com/linhaotxl/frontend/raw/master/packages/notes/src/NativeMethod/New/example_01.jpg?raw=true )  

可以看出，`nicholas` 就是一个普通的对象，并且，并且它的原型 `__proto__` 指向了构造函数的 `prototype`。  

## 示例二  
上面的示例中，构造函数没有返回值，所以 `new` 的结果就是我们生成的实例对象。那如果构造函数本身就存在返回值呢。  
从下面例子中可以看出，如果构造函数本神有返回值，且是一个有效的对象，那么 `new` 构造函数的结果就是这个对象，除此之外都是实例对象。  

```javascript
function Person ( name ) {
    this.name = name;
    // 以下情况都会返回对应的返回值
    return { age: 21 };
    return [];
    return new Date();
    return new Regexp();
    return function () {};
    // 以下情况都会返回本身的实例对象，也就是会忽略这个返回值
    return 1;
    return '1';
    return true;
    return null;
    return undefined;
    return Symbol();
}

const nicholas = new Person( 'nicholas' );
```

通过上面的例子，可以发现 `new` 的过程大概有四步:  
1. 创建一个空的对象  
2. 将这个对象的原型指向构造函数的 `prototype`  
3. 执行构造函数，并将构造函数的 `this` 指向上面创建的对象  
4. 判断构造函数的返回结果，如果是有效对象，那么直接返回这个有效对象；否则返回上面创建的对象  

# 实现 new 操作符  
因为 `new` 是一个关键字，所以我们通过函数来模拟实现  

```javascript
function _new ( ctor ) {
    const args = Array.prototype.slice.call( arguments, 1 );

    // 1. 创建空对象，并将其原型 __proto__ 指向构造函数的 prototype
    const instance = Object.create( ctor.prototype );

    // 3. 执行构造函数
    const result   = ctor.apply( instance, args );

    // 4. 判断构造函数返回结果
    return (typeof result === 'object' && result !== null) || typeof result === 'function'
        ? result
        : instance;
}
```
