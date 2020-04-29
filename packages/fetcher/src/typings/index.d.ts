
// request
declare class FetcherRequest extends Request {}
declare interface IFetcherExtend {
    dataType: ResponseDataType;
}

// response
declare class FetcherResponse extends Response {}
declare type ResponseDataType = 'json' | 'blob' | 'text ' | 'formData' | 'arrayBuffer';

// next
declare type Next = () => void;

// middleware
declare type Middleware = ( ctx: MiddlewareContext, next: Next ) => void;

// context
declare type MiddlewareContext = {
    request: FetcherRequest;
    response: FetcherResponse;
};