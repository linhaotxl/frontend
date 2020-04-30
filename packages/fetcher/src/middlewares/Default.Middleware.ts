import FetchMiddleware from './Fetch.Middleware';
import ResponseTypeMiddleware from './Response.Type.Middleware';

const defaultMiddleware: Middleware[] = [
    FetchMiddleware,
    ResponseTypeMiddleware
];

export default defaultMiddleware;