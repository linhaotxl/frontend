/**
 * 节流 - 时间戳版
 * @param { function } func 指定函数
 * @param { number } wait 间隔时间
 */
function throttle ( func: Function, wait: number ) {
    let lastTime: number = Date.now();

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

        if ( Date.now() - lastTime >= wait ) {
            func.apply( self, args );
            lastTime = Date.now();
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