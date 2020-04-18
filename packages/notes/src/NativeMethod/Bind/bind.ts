function _bind ( context ) {
    const self = this;
    const args = Array.prototype.slice.call( arguments, 1 );

    return function bound () {
        const innerArgs = Array.prototype.slice.call( arguments );
        self.apply( context, [ ...args, ...innerArgs ] );
    }
}

Object.defineProperty( Function.prototype, '_bind', {
    value: _bind
});

function test ( a, b, c, d ) {
    console.log( a, b, c, d );
}

function foo ( name ) {
    this.name = name;
}

function test1 () {
    const testObj = {
        name: 'IconMan'
    };

    const testBind = (test as any)._bind( testObj, 1, 2, 3 );
    testBind( 4 );  // 1 2 3 4
}

function test2 () {
    const obj = {};
    const testFoo = ( foo as any )._bind( obj );
    testFoo( 'IconMan' );
    console.log( obj ); // { name: 'IconMan' }

    const result = new testFoo( 'Nicholas' );
    console.log( obj );     // { name: 'Nicholas' }
    console.log( result );  // function bound {}
}

export default function start () {
    test2();
}

/**
 * 将 bind 后的函数称为绑定函数，bind 的调用者称为原始函数
 * 可以看出，new 绑定函数后，this 指向还是最开始恒定不变的指向
 * 而此时应该是将 this 指向 new 实例化的那个对象
 * 所以要判断是否是由 new 调用，从而改变 this 的指向
 */