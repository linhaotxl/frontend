function _bind ( context ) {
    const self = this;
    const args = Array.prototype.slice.call( arguments, 1 );

    function bound () {
        // 判断当前是否是 new 调用的绑定函数
        // 如果是 new bound() 的话，那么此时 this 就指向实例化的对象，且它的构造函数就是 bound
        // 所以 this.__proto__ 指向 bound.prototype 即 self.prototype
        // 所以如果是 new bound() 的话，我们将原始函数的作用域指向为 this，即当前实例化对象
        const that = this instanceof self ? this : context;
        const innerArgs = Array.prototype.slice.call( arguments );
        self.apply( that, [ ...args, ...innerArgs ] );
    }

    // 将 bound 的原型指向原始函数的原型，以供之后判断是否是 new 调用的绑定函数
    bound.prototype = self.prototype;

    return bound;
}

Object.defineProperty( Function.prototype, '_bind', {
    value: _bind
});

function foo ( name ) {
    this.name = name;
}

function test2 () {
    const obj = {};
    const testFoo = ( foo as any )._bind( obj );
    testFoo( 'IconMan' );
    console.log( obj ); // { name: 'IconMan' }

    const result = new testFoo( 'Nicholas' );
    console.log( obj );     // { name: 'IconMan' }
    console.log( result );  // foo { name: 'Nicholas' }
}

export default function start () {
    test2();
}

/**
 * 这个版本的 bind 几乎完美了，还差最后一个
 * 我们直接修改了 bound.prototype，所以如果我们想在绑定函数的原型上加数据
 * 那么在原始函数的原型上也会加
 * 所以我们需要一个中间人来避免这个问题
 */