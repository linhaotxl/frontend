export default class FetcherRequest extends Request {

    dataType: ResponseDataType;
    baseUrl: string;

    constructor ( info: RequestInfo, init?: RequestInit & IFetcherExtend ) {
        const { dataType, baseUrl, ...reset } = init;
        super( info, reset );

        this.initialExtendProperty( init );
    }

    initialExtendProperty ({ dataType, baseUrl }: RequestInit & IFetcherExtend) {
        this.baseUrl  = baseUrl;
        this.dataType = dataType ? dataType : 'json';
    }


}