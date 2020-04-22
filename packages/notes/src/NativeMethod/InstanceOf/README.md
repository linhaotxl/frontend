# instanceof 原理    
使用方法    

```javascript
对象 instanceof 构造函数
```   

`instanceof` 的作用就是检测某个对象是否属于构造函数的实例，包括存在继承关系。  
其实它的检测原理很简单，就是检测构造函数的 `prototype` 是否存在于对象的原型链上。  

# instanceof 实现  
实现 `instanceof` 可分为几个步骤:  
1. 获取对象的原型，并判断是否是构造函数的 `prototype`  
2. 如果不是，则继续向上获取原型对象，重复第一步   

因为 `instanceof` 属于关键字，所以通过函数来模拟实现  

```javascript
function _instanceof ( obj, ctor ) {
    const right = ctor.prototype;
    let left    = Object.getPrototypeOf( obj );

    while ( true ) {
        if ( left === null ) {
            return false;
        }

        if ( right === left ) {
            return true;
        }

        left = Object.getPrototypeOf( left );
    }
}
```  