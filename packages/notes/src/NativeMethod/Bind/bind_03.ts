const slice = Array.prototype.slice;

function _bind ( context ) {
    const self = this;
    const args = slice.call( arguments, 1 );

    function bound () {
        const extraArgs = slice.call( arguments );
        const that = this instanceof fNOP ? this : context;
        self.apply( that, [ ...args, ...extraArgs ] );
    }

    function fNOP () {}

    fNOP.prototype = self.prototype;
    bound.prototype = new fNOP();

    return bound;
}