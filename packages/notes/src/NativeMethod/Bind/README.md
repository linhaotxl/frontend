# 实现 bind 方法  
`bind` 方法接受一个作用域对象，以及一系列的参数，它会改变调用函数的 `this` 指向，并将剩余的参数传递给  

# 版本一  
```javascript
Function.prototype._bind = function ( context ) {
    const self = this;
    const args = Array.prototype.slice.call( arguments, 1 );

    return function bound () {
        const innerArgs = Array.prototype.slice.call( arguments );
        self.apply( context, args.concat( innerArgs ) );
    }
}
```  

在下面的示例中，使用自定义的 `_bind` 方法是没有任何问题的，修改了 `test` 的作用域
```javascript
const testObj = { name: 'IconMan' };
function test ( a, b, c, d ) {
    console.log( this, a, b, c, d );
}
const testBind = test._bind( testObj, 1, 2, 3 );
testBind( 4 );  // 打印 { name: 'IconMan' } 1, 2, 3, 4
```  

再看下面这段代码，我们称使用 `_bind` 后生成的函数为绑定函数  
如果我们把绑定函数当作构造函数去实例化的话，
```javascript
const _personObject = { name: 'IconMan' };
function _person ( name ) {
    this.name = name;
}
const Person = _person._bind( _personObject );
const nicholas = new Person( 'Nicholas' );
console.log( nicholas );
```  

