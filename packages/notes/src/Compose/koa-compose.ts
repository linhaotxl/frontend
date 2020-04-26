import { SyncMiddleware1, SyncMiddleware2, SyncMiddleware3, SyncMiddleware4 } from './test.sync';
import { AsyncMiddleware1, AsyncMiddleware2, AsyncMiddleware3, AsyncMiddleware4, AsyncMiddleware5, AsyncMiddleware6 } from './test.async';

type Middleware = (context: MiddlewareContext, next: Function) => void;
type MiddlewareContext = object;

// function compose ( ...middlewares: Middleware[] ) {
//     return function ( context: MiddlewareContext ) {
//         function next ( index: number ): any {
//             if ( index >= middlewares.length ) {
//                 return ;
//             }

//             const middleware = middlewares[index];

//             return middleware.apply( null, [ context, next.bind( null, index + 1 ) ] );
//         }

//         next( 0 );
//     }
// }

export function compose(middlewares: any[]) {
    if ( !Array.isArray( middlewares ) ) {
        throw new TypeError( 'Middleware stack must be an array!' );
    }
    for ( const middleware of middlewares ) {
        if ( typeof middleware !== 'function' ) {
            throw new TypeError( 'Middleware must be composed of functions!' );
        }
    }

    return function composeInner (ctx: any, next?: Function) {
        let lastCallIndex: number = -1;

        function dispatch(index: number): any {
            console.log( 'lastCallIndex -> ', lastCallIndex, ' index -> ', index );
            if ( index <= lastCallIndex ) {
                return Promise.reject( new Error( 'next() called multiple times' ) );
            }

            lastCallIndex = index;

            let middleware = middlewares[index];
            if ( middlewares.length === index ) {
                middleware = next;
            }

            if ( !middleware ) {
                return Promise.resolve()
            }

            try {
                return Promise.resolve(middleware(ctx, dispatch.bind(null, index + 1)));
            } catch (e) {
                return Promise.reject(e);
            }
        }

        // 默认执行第一个中间件
        return dispatch(0);
    }
}

function wait(ms: number) {
    return new Promise(resolve => setTimeout(() => {
        resolve();
    }, ms || 1000))
}

function isPromise(x: any) {
    return typeof x.then === 'function';
}

function test() {
    // var called: number[] = []

    // return compose([
    //     compose([
    //         (ctx: any, next: any) => {
    //             called.push(1)
    //             return next()
    //         },
    //         (ctx: any, next: any) => {
    //             called.push(2)
    //             return next()
    //         }
    //     ]),
    //     (ctx: any, next: any) => {
    //         called.push(3)
    //         return next()
    //     }
    // ])({}).then(() => console.log('called -> ', called))
}

function testError() {
    compose([SyncMiddleware4])({})
        .catch((err: any) => {
            console.log('err -> ', err instanceof Error);
        });
}

function testQian () {
    const stack = []

    stack.push(async (context: any, next: any) => {
      var val = await next()
      console.log( 'middleware1 in ', val )
      return 1
    })

    stack.push(async (context: any, next: any) => {
      const val = await next()
      console.log( 'middleware2 in ', val )
      return 2
    })

    const next = () => 0
    return compose(stack)({}, next).then(function (val: any) {
        console.log( 'value6 -> ', val )
    //   expect(val).toEqual(1)
    })
}

function test2 () {
    return compose([
        (ctx: any, next: Function) => {
            next()
        },
        (ctx: any, next: Function) => {
            next()
            next()
        }
    ])({}).then(() => {
        throw new Error('boom')
    })
    .catch((err: any) => {
        console.log( 'err -> ', err.message )
    })
}

export default async function start() {
    // testQian();
    test2();
    // await compose([  ])( {} );
    // console.log( '执行完成.' );
    // compose([ AsyncMiddleware4 ])({})
    // .then( (data: any) => {
    //     console.log( 'data -> ', data );
    //     // throw new Error( '666' );
    // })
    // .catch( (err: any) => {
    //     console.log( 'err1 -> ', err instanceof Error );
    // });
    // compose([ AsyncMiddleware1, AsyncMiddleware5, AsyncMiddleware2 ])({});
}