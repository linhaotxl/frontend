export default function compose<C = any>( middlewares: Function[] ) {
    if ( !Array.isArray( middlewares ) ) {
        throw new TypeError( 'Middleware stack must be an array!' );
    }
    for ( const middleware of middlewares ) {
        if ( typeof middleware !== 'function' ) {
            throw new TypeError( 'Middleware must be composed of functions!' );
        }
    }

    return function composeInner (ctx: C, next?: Function ) {
        let lastCallIndex: number = -1;

        function dispatch(index: number): Promise<any> {
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