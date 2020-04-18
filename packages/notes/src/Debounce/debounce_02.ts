function debounce ( func: Function, wait: number ) {
    let timer = null;
    let active = false;

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

        if ( !active ) {
            func.apply( self, args );
            active = true;
            return ;
        }
        
        clearTimeout( timer );
        timer = setTimeout(() => {
            func.apply( self, args );
            active = false;
        }, wait);
    }
}

function handlerScroll () {
    console.log( 'scroll' );
}

export default function start () {
    const scroll = debounce( handlerScroll, 1000 );
    scroll();
}