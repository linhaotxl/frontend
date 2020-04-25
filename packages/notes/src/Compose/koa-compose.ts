import { SyncMiddleware1, SyncMiddleware2, SyncMiddleware3 } from './test.sync';
import { AsyncMiddleware1, AsyncMiddleware2, AsyncMiddleware3, AsyncMiddleware4, AsyncMiddleware5 } from './test.async';

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
            if ( middlewares.length === index ) {
                return ;
            }

            const middleware = middlewares[index];
            // console.log( 1, index, middlewares[0] )
            middleware( ctx, dispatch.bind( null, index + 1 ) );
        }

        // 默认执行第一个中间件
        dispatch( 0 );
    }
}

export default function start () {
    compose( AsyncMiddleware1, AsyncMiddleware5, AsyncMiddleware2 )({});
}