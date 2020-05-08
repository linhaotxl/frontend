function throttle ( func: Function, wait: number ) {
    let start: number = Date.now();

    return function () {
        const self = this;
        const args = Array.prototype.shift.call( arguments );
        const current = Date.now();

        if ( current - start >= wait ) {
            func.apply( self, args );
            start = Date.now();
        }
    }
}

function handlerScroll () {
    console.log( 'scroll' );
}

export default function start () {
    const handlerScrollThrottle = throttle( handlerScroll, 500 );
    handlerScrollThrottle();
}