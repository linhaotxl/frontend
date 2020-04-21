function _new ( ctor: Function, ...args ) {
    const instance = Object.create( ctor.prototype );
    const result   = ctor.apply( instance, args );

    return (typeof result === 'object' && result !== null) || typeof result === 'function'
        ? result
        : instance; 
}

function Person ( name ) {
    this.name = name;
}

export default function start () {
    const nicholas = _new( Person, 'name' );
    console.log( nicholas );
    console.log( nicholas.__proto__ === Person.prototype );
}