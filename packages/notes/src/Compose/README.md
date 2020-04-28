# compose  

## koa-compose  
`koa-compose` 其实就是一种串行处理中间件的方式，并且可以通过 `async/await` 来控制各个中间件的执行流程，它是典型的洋葱模型。  

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

compose( SyncMiddleware1, SyncMiddleware2, SyncMiddleware3 )({});
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

![洋葱模型]( https://github.com/linhaotxl/frontend/blob/master/packages/notes/src/Compose/example_01.jpg?raw=true )  

### 实现 koa-compose   
首先从上面的例子中可以看出以下几点  
1. `compose` 的参数是中间件数组  
2. `compose` 返回一个新的函数，新的函数接受一个作用域参数，即每个中间件的 `ctx` 参数  
3. 中间件必须是函数，且可以接受两个参数，作用域对象 `ctx` 和执行下一个中间件的回调 `next`   
4. 因为我们不知道总共有几个中间件，所以必须在每个中间件内手动调用 `next` 来保证后续的中间件能被执行  
5. 默认会调用第一个中间件   

#### 版本一  

```javascript
function compose ( middlewares ) {
    return function composeInner ( ctx ) {
        function dispatch ( index ) {
            // 获取当前的中间件
            const middleware = middlewares[index];
            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件
        dispatch( 0 );
    }
}
```  

这是一个最简易的 `compose` 实现，先来测试下  
以下所有例子里用到的函数都来自于 [test.sync.ts](https://github.com/linhaotxl/frontend/blob/master/packages/notes/src/Compose/test.sync.ts) 和 [test.async.ts](https://github.com/linhaotxl/frontend/blob/master/packages/notes/src/Compose/test.async.ts)  

```javaascript
compose([ Middleware1, Middleware2, Middleware3 ])({});
```    

运行上面代码会报错  
```javascript
TypeError: middleware is not a functions
```   

是因为在最后一个中间件里仍然执行了 `next` 方法，导致在中间件数组 `middlewares` 越界了，所以我们需要判断是否已经运行到最后一个中间件。  

#### 版本二  

```javascript
function compose ( middlewares ) {
    return function ( ctx ) {
        function dispatch ( index ) {
            // 检测是否已经执行到最后一个中间件
            if ( middlewares.length === index ) {
                return ;
            }

            // 获取当前的中间件
            const middleware = middlewares[index];
            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件
        dispatch( 0 );
    }
}
```  

上面代码会输如下，`undefined` 先不用管，后续会说到  
```javascript
// Sync Middleware1 start.
// Sync Middleware2 start.
// Sync Middleware3 start.
// Sync Middleware3 end. undefined
// Sync Middleware2 end. undefined
// Sync Middleware1 end. undefined
```  

上面示例是一个同步的，现在再来看一个异步示例  

```javascript
compose([ AsyncMiddleware1, AsyncMiddleware5, AsyncMiddleware2 ])({});
```  

打印如下  
```javascript
// Async Middleware1 start.
// Async Middleware5 start.
// delay start
// Async Middleware1 end. undefined
// 3s 后
// delay end
// Async Middleware2 start.
// Async Middleware2 end. undefined
// Async Middleware5 end. undefined
```    

可以看出，和我们预期的结果不符，预期的结果应该是下面这样  
```javascript
// Async Middleware1 start.
// Async Middleware5 start.
// delay start
// 3s 后
// delay end
// Async Middleware2 start.
// Async Middleware2 end. undefined
// Async Middleware5 end. undefined
// Async Middleware1 end. undefined
```      

`Async Middleware1 end. undefined` 这句应该在最后一步执行，但是这里却提前执行了。  
首先来看 `Async Middleware1` 中间件内部，执行 `await next()` 等待，但此时 `next` 函数返回的是 `undefiend` 而不是 `Promise`，所以会将后面的任务直接放在微任务里，而不是等到下一个中间件执行完成后，再执行之后的逻辑。  
所以 `next` 方法要返回一个 `Promise` 对象，而对于 `async` 的中间件本身就会返回一个 `Promise`，所以可以直接将中间件函数 `return` 出来。    

#### 版本三  

```javascript
function compose ( middlewares ) {
    return function ( ctx ) {
        function dispatch ( index ) {
            // 检测是否已经执行到最后一个中间件
            if ( middlewares.length === index ) {
                return ;
            }

            // 获取当前的中间件
            const middleware = middlewares[index];
            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去，保证在调用 await next() 时能先执行后面的中间件，再执行之后的逻辑
            return middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件
        dispatch( 0 );
    }
}
```  

继续执行上面的异步示例，得到的就是正确的结果了  

再看一种情况  
```javascript
await compose([ AsyncMiddleware1, AsyncMiddleware5, AsyncMiddleware2 ])( {} );
console.log( '执行完成.' );
```  

上面代码会输出  
```javascript
// Async Middleware1 start.
// Async Middleware5 start.
// delay... start
// 执行完成.
// 3s 后
// delay... end
// Async Middleware2 start.
// Async Middleware2 end. undefined
// Async Middleware5 end. undefined
// Async Middleware1 end. undefined
```  

可以看出，“执行完成” 的顺序不合适，经过上面的示例，这里可以轻松的看出问题是类似的，在默认执行第一个中间件时，如果前面加了 `await` 的话，那么此时在执行 `compose([])({})` 的返回值也要是一个 `Promise`，也就是需要 `return` 第一个中间件  

#### 版本四  

```javascript
function compose ( middlewares ) {
    return function ( ctx ) {
        function dispatch ( index ) {
            // 检测是否已经执行到最后一个中间件
            if ( middlewares.length === index ) {
                return ;
            }

            // 获取当前的中间件
            const middleware = middlewares[index];
            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去，保证在调用 await next() 时能先执行后面的中间件，再执行之后的逻辑
            return middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件，并返回出去，处理 await 的情况
        return dispatch( 0 );
    }
}
```  

按照官方的测试用例来看，每个中间件中的 `next` 方法必须返回一个 `Promise` 对象，所以修改如下  

#### 版本五  

```javascript
function compose ( middlewares ) {
    return function ( ctx ) {
        function dispatch ( index ) {
            // 检测是否已经执行到最后一个中间件
            if ( middlewares.length === index ) {
                return Promise.resolve();
            }

            // 获取当前的中间件
            const middleware = middlewares[index];
            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去，保证在调用 await next() 时能先执行后面的中间件，再执行之后的逻辑
            return Promise.resolve( middleware( ctx, dispatch.bind( null, index + 1 ) ) );
        }

        // 默认执行第一个中间件，并返回出去，处理 await 的情况
        return dispatch( 0 );
    }
}
```    

再看一个中间件抛出错误的示例  

```javascript
compose([ SyncMiddleware4 ])({})
.catch( (err: any) => {
    console.log( 'err -> ', err instanceof Error );
});
```  

这段代码在执行第一个中间件时会抛出一个错 `Sync Middleware4 Error.`，而且又没有处理这个错误的回调，因为此时返回的仍然是 `resolved` 的 `Promise`  

对于这种情况，我们应该在内部检测是否出现了错误，如果出现错误应该返回一个 `rejected` 的 `Promise` 对象，而不是依旧返回一个 `resolved` 的 `Promise` 对象，修改如下  

#### 版本六  

```javascript
function compose ( middlewares ) {
    return function ( ctx ) {
        function dispatch ( index ) {
            // 检测是否已经执行到最后一个中间件
            if ( middlewares.length === index ) {
                return Promise.resolve();
            }

            // 获取当前的中间件
            const middleware = middlewares[index];
            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去，保证在调用 await next() 时能先执行后面的中间件，再执行之后的逻辑
            try {
                return Promise.resolve( middleware( ctx, dispatch.bind( null, index + 1 ) ) );
            } catch ( e ) {
                return Promise.reject( e );
            }
        }

        // 默认执行第一个中间件，并返回出去，处理 await 的情况
        return dispatch( 0 );
    }
}
```  

接下来再看一种嵌套的情况  

```typescript
const called: number[] = [];
const middleware1 = ( _: any, next: Function ) => {
    called.push( 1 );
    return next();
}

const middleware2 = ( _: any, next: Function ) => {
    called.push( 2 );
    return next();
}

const middleware3 = ( _: any, next: Function ) => {
    called.push( 3 );
    return next();
}

return compose([
    compose([ middleware1, middleware2 ]),
    middleware3
])({}).then(() => console.log('called -> ', called));

// called -> [ 1, 2 ]
```  

从输出结果可以看出，`middleware3` 这个中间件没有执行，先来走遍流程  
1. 外部 `compose` 里有两个中间件，一个是内部 `compose` 返回的结果 `composeInner` 函数，一个是 `middleware3`  
2. 外部 `compose` 执行 `dispatch(0)`，也就是第一个中间件 `composeInner`
3. 再执行内部 `return dispatch(0)`  
4. 执行 `middleware1` 中间件，并通过 `next` 执行第二个  
5. 执行 `middleware2` 中间件，并通过 `next` 执行后面的中间件（ 已经没有其他中间件了，所以会直接返回 ）
6. 所有的中间件都执行完了，回到第三步，再回到第二步，流程结束  

所以，根本就没有调用 `middleware3` 这个中间件。原因就在于，我们是判断 `index === middlewares.length` 成立后，就直接 `return` 了，而此时还存在其他的中间件的。  
而这种情况只会出现在嵌套 `compose` 的情况中，像之前的例子中，都只有一层 `compose`，所以只会遍历这一层的中间件。  
现在，如果执行完了一层中的中间件，我们应该继续去执行下一层的中间件

那如何去处理下一层的中间件呢？  
首先要明确的是，如果我们使用 `compose` 嵌套了一层，那么在外部的 `compose` 函数中，嵌套的这个中间件实际就是 `composeInner` 函数，而对于每个中间件都会有 `ctx` 和 `next` 两个参数，所以 `composeInner` 也一样，而 `composeInner` 中的 `next` 参数，就是执行外部中间件数组中的下一个中间件，修改后的代码如下  

#### 版本七  

```javascript
function compose ( middlewares ) {
    return function composeInner ( ctx, next ) {
        function dispatch ( index ) {
            // 获取当前的中间件
            let middleware = middlewares[index];
            
            // 检测是否已经执行到一层中的最后一个中间件，如果是的话将执行外部中间件数组的方法赋值给 middleware
            if ( middlewares.length === index ) {
                middleware = next;
            }

            // 检测中间件是否有效，这个条件只有在执行到整个流程的最后一个中间件才会满足
            if ( !middleware ) {
                return Promise.resolve();
            }

            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去，保证在调用 await next() 时能先执行后面的中间件，再执行之后的逻辑
            try {
                return Promise.resolve( middleware( ctx, dispatch.bind( null, index + 1 ) ) );
            } catch ( e ) {
                return Promise.reject( e );
            }
        }

        // 默认执行第一个中间件，并返回出去，处理 await 的情况
        return dispatch( 0 );
    }
}
```  

对于正常情况，每一个中间件里只能调用一次 `next`，不能多次调用，所以接下来的版本需要处理这种情况   

可以使用一个值来记录上一次调用中间件的索引，然后和当前索引比较。如果是正常逻辑的话，那么每次执行中间件时，上一次索引 = 本次索引 - 1，如果执行了多次 `next` 的话，那么 上一次索引会 + 1，而本次索引是固定不变的    

#### 版本八  

```javascript
function compose ( middlewares ) {
    return function composeInner ( ctx, next ) {
        let lastCallIndex = -1;

        function dispatch ( index ) {
            // 检测是否多次调用
            if ( lastCallIndex >= index ) {
                return Promise.reject( new Error( 'next() called multiple times' ) );
            }

            // 更新上次调用的索引值
            lastCallIndex = index;

            // 获取当前的中间件
            let middleware = middlewares[index];
            
            // 检测是否已经执行到最后一个中间件，如果是的话将执行外部中间件数组的方法赋值给 middleware
            if ( middlewares.length === index ) {
                middleware = next;
            }

            // 检测中间件是否有效，这个条件满足在处理最后一个中间件
            if ( !middleware ) {
                return Promise.resolve();
            }

            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去
            try {
                return Promise.resolve( middleware( ctx, dispatch.bind( null, index + 1 ) ) );
            } catch ( e ) {
                return Promise.reject( e );
            }
        }

        // 默认执行第一个中间件，并返回出去，处理 await 的情况
        return dispatch( 0 );
    }
}
```  

还差最后一步，`compose` 的参数必须是一个中间件数组，而且每个中间件都必须是函数，所以加入校验  

#### 最终版本  

```javascript
function compose ( middlewares ) {
    // 检验参数
    if ( !Array.isArray( middlewares ) ) {
        throw new TypeError( 'Middleware stack must be an array!' );
    }
    for ( const middleware of middlewares ) {
        if ( typeof middleware !== 'function' ) {
            throw new TypeError( 'Middleware must be composed of functions!' );
        }
    }

    return function composeInner ( ctx, next ) {
        let lastCallIndex = -1;

        function dispatch ( index ) {
            // 检测是否多次调用
            if ( lastCallIndex >= index ) {
                return Promise.reject( new Error( 'next() called multiple times' ) );
            }

            // 更新上次调用的索引值
            lastCallIndex = index;

            // 获取当前的中间件
            let middleware = middlewares[index];
            
            // 检测是否已经执行到最后一个中间件，如果是的话将执行外部中间件数组的方法赋值给 middleware
            if ( middlewares.length === index ) {
                middleware = next;
            }

            // 检测中间件是否有效，这个条件满足在处理最后一个中间件
            if ( !middleware ) {
                return Promise.resolve();
            }

            // 执行中间件，并传入作用域对象 ctx 和 dispatch 方法，并且 dispatch 方法的参数会自动 + 1
            // 这样，在中间件里我们调用 next 的时候就不需要传参数，就会执行下一个中间件了
            // 将中间件函数返回出去
            try {
                return Promise.resolve( middleware( ctx, dispatch.bind( null, index + 1 ) ) );
            } catch ( e ) {
                return Promise.reject( e );
            }
        }

        // 默认执行第一个中间件，并返回出去，处理 await 的情况
        return dispatch( 0 );
    }
}
```  
