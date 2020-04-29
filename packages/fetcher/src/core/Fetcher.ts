import compose from '../utils/compose';
import { isFunction } from '../utils/type';
import FetcherRequest from './Request';
import FetcherResponse from './Response';
import fetchMiddleware from '../middlewares/Fetch.Middleware';

export default class Fetcher {

    private _middlewares: Middleware[] = [];

    constructor () {
        this.use( fetchMiddleware );
    }

    use ( ...middlewares: Middleware[] ) {
        middlewares.forEach( middleware => {
            if ( !isFunction( middleware ) ) {
                throw new Error( 'middleware must be a function.' );
            }
        });

        this._middlewares.push( ...middlewares );
    }
    
    createContext ( info: RequestInfo, init?: RequestInit & IFetcherExtend ): MiddlewareContext {
        const request: FetcherRequest   = new FetcherRequest( info, init );
        const response: FetcherResponse = null;
        return { request, response };
    }

    fetch ( info: RequestInfo, init?: RequestInit & IFetcherExtend ) {
        const context = this.createContext( info, init );
        return compose( this._middlewares )( context );
    }

    get ( info: RequestInfo, init?: RequestInit & IFetcherExtend ) {
        return this.fetch( info, { ...init, method: 'get' });
    }

    post ( info: RequestInfo, init?: RequestInit & IFetcherExtend ) {
        return this.fetch( info, { ...init, method: 'post' });
    }

}