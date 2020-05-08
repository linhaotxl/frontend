/**
 * 防抖 - 立即触发
 * @param { Function } 执行的回调
 * @param { Number } 等待的时间
 */
function debounce ( func: Function, wait: number ) {
    let timer: number    = null;    // 定时器变量
    let isFirst: boolean = true;    // 是否是第一次执行的开关变量

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

        // 如果是第一次，那么会执行 func，执行后就结束调用
        if ( isFirst ) {
            func.apply( self, args );
            isFirst = false;
            return ;
        }
        
        // 如果不是第一次，首先会清除定时器
        clearTimeout( timer );

        // 然后会重新设置，确保 wait 秒后再次执行 func
        // 执行完 func 后，需要将开关变量 isFirst 重置，确保下次流程正常
        timer = setTimeout(() => {
            func.apply( self, args );
            isFirst = true;
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