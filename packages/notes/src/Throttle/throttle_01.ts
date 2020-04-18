function throttle ( func: Function, wait: number ) {
    let timer = null;

    return function () {
        const self = this;
        const args = Array.prototype.shift.call( arguments );

        if ( timer !== null ) {
            return ;
        }

        timer = setTimeout(() => {
            func.apply( self, args );
            timer = null;
        }, wait);
    }
}

function handlerScroll () {
    console.log( 'scroll' );
}

export default function start () {
    const handlerScrollThrottle = throttle( handlerScroll, 500 );
    handlerScrollThrottle();
}