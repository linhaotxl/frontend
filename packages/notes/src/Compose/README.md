# compose  

## koa-compose  
`koa-compose` 其实就是一种串行处理中间件的方式，并且可以通过 `async/await` 来控制各个中间件的执行流程，这就是典型的洋葱模型。  

下面是一个 ”洋葱模型“ 的案例   
```javascript
const middleware1 = ( ctx, next ) => {
    console.log( 'step1 start.' );
    await next();
    console.log( 'step1 end.' );
}

const middleware2 = ( ctx, next ) => {
    console.log( 'step2 start.' );
    await next();
    console.log( 'step2 end.' );
}

const middleware3 = ( ctx, next ) => {
    console.log( 'step3 start.' );
    await next();
    console.log( 'step3 end.' );
}

compose( middleware1, middleware2, middleware3 )({});
```   

上面的代码会输出  
```javascript
// step1 start.
// step2 start.
// step3 start.
// step3 end.
// step2 end.
// step1 end.
```  

可以看到，当执行到 `await next()` 的时候，首先会去处理下一个中间件，等到下一个中间件处理完成后，再回到当前中间件，继续处理之后的任务。  

这就是典型的洋葱模型，如图，由外层逐渐向里层，然后再一层一层出来  

![洋葱模型]( http://linhaotxl/frontend/blob/master/packages/notes/src/Compose/example_01.jpg?raw=true )  

### 实现 koa-compose   
首先从上面的例子中可以看出以下几点  
1. `compose` 的参数是一系列的中间件  
2. `compose` 返回一个新的函数，新的函数接受一个作用域参数，即每个中间件的 `ctx` 参数  
3. 中间件必须是函数，且可以接受两个参数，作用域对象 `ctx` 和执行下一个中间件的回调 `next`   
4. 每个中间件都必须要执行 `next` 方法来处理下一个中间件，因为 `compose` 函数默认只会调用第一个中间件 

```javascript
function compose ( ...middlewares ) {
    return function ( ctx ) {
        function dispatch ( index ) {
            const middleware = middlewares[index];

            middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件
        dispatch( 0 );
    }
}
```  

这是一个最简易的 `compose` 实现，先来测试下  

```javaascript
compose( Middleware1, Middleware2, Middleware3 )({});
```    

运行上面代码会报错