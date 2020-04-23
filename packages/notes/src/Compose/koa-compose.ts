import { Middleware1, Middleware2, Middleware3 } from './test.sync';
// import { Middleware1, Middleware2, Middleware3, Middleware4, Middleware5 } from './test.async';

type Middleware = ( context: MiddlewareContext, next: Function ) => void;
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

function compose ( ...middlewares: any[] ) {
    return function ( ctx: any ) {
        function dispatch ( index: number ) {
            const middleware = middlewares[index];
            // console.log( 1, index, middlewares[0] )
            middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件
        dispatch( 0 );
    }
}

export default function start () {
    compose( Middleware1, Middleware2, Middleware3 )({});
}