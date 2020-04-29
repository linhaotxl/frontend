export default class FetcherRequest extends Request {
    constructor ( info: RequestInfo, init?: RequestInit & IFetcherExtend ) {
        const { dataType, ...reset } = init;
        super( info, reset );
    }


}