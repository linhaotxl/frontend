/**
 * 防抖 - 非立即触发
 * @param { Function } 执行的回调
 * @param { Number } 等待的时间
 */
function debounce ( func: Function, wait: number ) {
    // 定时器变量，用于之后设置在 wait 秒后执行
    let timer: number = null;

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

        // 每次执行都会先清除一次
        clearTimeout( timer );

        // 清除完后再重新设置一次，在 wait 秒后执行
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