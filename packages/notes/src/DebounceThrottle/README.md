# 防抖和节流  
这其实是优化的两种方式，通常我们会用到浏览器的滚动事件，但是如果频繁的触发它们，可能会对性能有一定的影响，所以需要进行一定的优化处理，防抖和节流就是通常使用的方法  

## 防抖  
防抖主要是在指定的 `n` 秒后才会执行，而不是频繁的去触发，主要分为两种  
1. 非立即触发: 在一开始滚动滚动条的时候并不触发，直到停止滚动后的 `n` 秒才会触发  
2. 立即触发: 在一开始滚动滚动条的时候触发一次，然后直到停止滚动后的 `n` 秒才再触发一次  

### 非立即触发  
**非立即触发** 的核心思想就是每次都会清除一次定时器，然后再重新设置一次定时器  

```javascript
/**
 * 防抖 - 非立即触发
 * @param { Function } 执行的回调
 * @param { Number } 等待的时间
 */
function debounce ( func: Function, wait: number ) {
    // 定时器变量，用于之后设置在 wait 秒后执行
    let timer = null;

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
```  

### 立即触发  
**立即触发** 的实现是在 “非立即触发” 的基础上，只不过多了一步，就是会声明一个开关变量，用于判断是否是第一次执行  

```javascript
/**
 * 防抖 - 立即触发
 * @param { Function } 执行的回调
 * @param { Number } 等待的时间
 */
function debounce ( func: Function, wait: number ) {
    let timer   = null; // 定时器变量
    let isFirst = true; // 是否是第一次执行的开关变量

    return function () {
        const self = this;
        const args = Array.prototype.slice.call( arguments );

        // 如果是第一次，那么会执行 func，并将开关变量置为 false，确保第二次后不会执行
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
```  

