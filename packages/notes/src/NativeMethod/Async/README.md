# Async  
`async` 可以将异步编程以同步的方式书写，其实它就是 `generator` 的语法糖，只不过 `generator` 函数需要手动执行，而 `async` 就是一种自动执行的 `generator`   
每个 `async` 函数的解析形式如下  

解析前  
```javascript
async function getList () {
    const result = await getListApi();
    return result;
}
```  

解析后   
```javascript
const getList = _async(function* () {
    const result = yield getListApi();
    return result;
}); 
```

可以看到这几点  
1. `async` 函数内部会被解析为 `generator` 函数，并且作为工具方法 `_async` 的参数  
2. 工具方法 `_async` 会返回一个函数
3. `async` 函数内部的 `await` 会替换为 `yield`  

解析的过程肯定是由 `babel` 完成的，所以接下来我们主要研究的就是 `_async` 方法的实现，通过这个方法可以将 `generator` 变为自动执行的  

# Async 实现  
首先声明几个函数，接下来的示例都会用到这些函数  

```javascript
const p1 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 1 );
    }, 1000)
});

const p2 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 2 );
    }, 2000)
});

const p3 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 3 );
    }, 3000)
});

const p4 = ( time: number ) => new Promise(( _, reject ) => {
    setTimeout(() => {
        reject( 'p4 失败' );
    }, time);
});
```  

## 示例一  
声明一个 `_async` 函数，接受一个 `generator` 函数作为参数  

```javascript  
function* myGenerator () {
    yield p1();
    yield p2();
    yield p3();
    return 0;
}

function _async ( generator ) {
    return function () {
        const gen = generator();

        gen.next().value.then( value1 => {
            console.log( 'first value -> ', value1 );
            gen.next().value.then( value2 => {
                console.log( 'second value -> ', value2 );
                gen.next().value.then( value3 => {
                    console.log( 'third value -> ', value3 );
                    console.log( 'return value -> ', gen.next().value );
                });
            });
        });
    }
}
```  
 
每调用一次 `next` 方法，返回的 `value` 属性都是一个 `Promise` 对象，我们将下次调用 `next` 的操作放到了上个 `Promise` 对象成功回调中，这样当上个 `Promise` 对象改变状态后，才会执行下一个 `yield` 操作  
这样就实现了自动执行 `generator` 最简单的版本  

通过 `_async` 来执行 `myGenerator` 得到如下结果  
```javascript
// 1s 后
// first value ->  1
// 2s 后
// second value ->  2
// 3s 后
// third value ->  3
// return value -> 0
```  

我们知道 `generator` 函数里的 `yield` 默认是没有返回值的，但是如果在调用 `next` 方法时传递了一个参数，那么这个参数就是上一个 `yield` 的返回值，而且第一次调用 `next` 方法传递的参数是没有用的  
我们利用这点，将上面的示例进行改造  

## 示例二  

```javascript
function* myGenerator () {
    console.log( 'first value -> '  + (yield p1()) );
    console.log( 'second value -> ' + (yield p2()) );
    console.log( 'third value -> '  + (yield p3()) );
    return 0;
}
```  

改造 `_async` 函数如下  

```javascript
function _async ( generator ) {
    return function () {
        const gen = generator();

        gen.next().value.then( value1 => {
            gen.next( value1 ).value.then( value2 => {
                gen.next( value2 ).value.then( value3 => {
                    console.log( 'return value -> ' + gen.next( value3 ).value );
                });
            });
        });
    }
}
```  

继续调用 `myGenerator`，可以看到执行结果还是和上面一样  

经过上面两个示例，我们实现了自动执行 `generator` 函数，但是上面的方法都是已知状态的个数，那么对于未知状态个数的方法怎么办？  
此时就会用到 `next` 方法返回的 `done` 属性，它表示是否结束了所有的状态，继续修改 `_async` 方法，这次修改为通用的方法  

## 示例三  
```javascript
function _async ( generator ) {
    return function () {
        const gen = generator();
        const dispatch = ( val?: any ) => {
            const result = gen.next( val );

            if ( result.done ) {
                return result.value;
            }

            result.value.then( dispatch );
        };

        return dispatch();
    }
}
```   

在这个版本里，声明了 `dispatch` 方法，这个方法的作用就是调用 `next` 方法来改变状态，如果没有结束的话，将下一次改变状态的方法放在本次获得的 `Promise` 对象的成功回调中，依次来达到自动执行的目的  

使用下面的这个方法来验证  

```javascript
function* myGenerator () {
    console.log( 'first value -> '  + (yield p1()) );
    console.log( 'second value -> ' + (yield p2()) );
    console.log( 'third value -> '  + (yield p3()) );
    console.log( 'forth value -> '  + (yield p1()) );
    return 0;
}
```  

通过 `_async` 函数调用 `myGenerator` 得到如下结果  
```javascript
// 1s 后
// first value -> 1
// 2s 后
// second value -> 2
// 3s 后
// third value -> 3
// 1s 后
// forth value -> 1
```  

这个版本的 `_async` 已经实现了自动执行的过程，但是存在几个问题  
1. `yield` 表达式后的值必须是 `Promise` 对象，所以需要兼容非 `Promise` 对象的情况   
2. 缺少错误处理  
    * `yield` 后的表达式抛出错误
    * `yield` 后的 `Promise` 失败
3. `async` 函数本身会返回一个 `Promise` 对象    

针对第一点和第三点实现起来还是很简单，修改 `_async` 如下  

```javascript
function _async ( generator ) {
    return function () {
        // 模拟 async 返回一个 Promise 对象
        return new Promise(( resolve, reject ) => {
            const gen = generator();
            const dispatch = ( val ) => {
                const result = gen.next( val );

                // 只有当执行结束后，才会将返回的 Promise 状态改为成功
                if ( result.done ) {
                    return resolve( result.value );
                }

                // 使用 Promise.resolve 来兼容非 Promise 的情况
                Promise.resolve( result.value )
                .then( dispatch );
            };

            return dispatch();
        });
    }
}
```  

对于第一个错误，如果 `yield` 后的表达式抛出了错误，那么我们在调用 `next` 方法的时候就能捕获到，并且如果捕获到的话，我们会立即将返回的 `Promise` 状态修改为失败，修改 `_async` 如下  

```javascript
function _async ( generator ) {
    return function () {
        // 模拟 async 返回一个 Promise 对象
        return new Promise(( resolve, reject ) => {
            const gen = generator();
            const dispatch = ( val ) => {
                let result;
                try {
                    result = gen.next( val );
                } catch ( e ) {
                    reject( e );
                    return ;
                }

                // 只有当执行结束后，才会将返回的 Promise 状态改为成功
                if ( result.done ) {
                    resolve( result.value );
                    return ;
                }

                // 使用 Promise.resolve 来兼容非 Promise 的情况
                Promise.resolve( result.value )
                .then( dispatch )
            };

            return dispatch();
        });
    }
}
```

对于第二点，首先来看下面这个示例  

```javascript
function getListApi () {
    return new Promise(( resolve, reject ) => {
        setTimeout(() => {
            reject([ 'Nicholas', 'IconMan' ]);
        }, 3000);
    });
}

function* getList () {
    let users;

    try {
        users = yield getListApi()
    } catch ( e ) {
        users = [];
    }

    console.log( 'users -> ', users );
}
```  

通常我们会将 `yield` 放在 `try..catch` 语句中，就是为了防止 `yield` 后的 `Promise` 返回一个失败的状态，如果返回失败状态，那么就会进入 `catch` 语句中，那么怎样才能让它进入到 `catch` 中？  

就是通过 `generator` 的 `throw` 方法，让 `generator` 函数在函数体内捕获到我们抛出的错误  
那我们在什么时候需要抛出错误？就是在 `Promise` 返回失败的时候才需要，修改 `_async` 如下  

```javascript
function _async ( generator ) {
    return function () {
        // 模拟 async 返回一个 Promise 对象
        return new Promise(( resolve, reject ) => {
            const gen = generator();
            const dispatch = ( val ) => {
                let result;
                try {
                    result = gen.next( val );
                } catch ( e ) {
                    reject( e );
                    return ;
                }

                // 只有当执行结束后，才会将返回的 Promise 状态改为成功
                if ( result.done ) {
                    resolve( result.value );
                    return ;
                }

                // 使用 Promise.resolve 来兼容非 Promise 的情况
                Promise.resolve( result.value )
                .then( dispatch )
                // 如果 Promise 失败的话，我们将错误抛给 generator 函数内部，由它自行解决
                .catch( e => {
                    gen.throw( e );
                });
            };

            return dispatch();
        });
    }
}
```  

现在继续运行 `getList` 函数，运行如下   
```javascript
// 3s 后
// users -> []
```