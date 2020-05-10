/**
 * 节流 - 定时器版
 * @param { function } func 指定函数
 * @param { number } wait 间隔时间
 */
function throttle ( func: Function, wait: number ) {
    let timer: number = null;

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

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