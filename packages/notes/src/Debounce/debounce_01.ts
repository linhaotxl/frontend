function debounce ( func: Function, wait: number ) {
    let timer = null;

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

        clearTimeout( timer );
        timer = setTimeout(() => {
            func.apply( self, args );
        }, wait)
    }
}

function handlerScroll () {
    console.log( 'scroll' );
}

export default function start () {
    const scroll = debounce( handlerScroll, 1000 );
    scroll();
}