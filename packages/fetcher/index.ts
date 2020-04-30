import Fetcher from './src/core/Fetcher';

export function createFetcher () {
    return new Fetcher();
}

const fetcher = createFetcher();

fetcher.get( 'http://192.168.40.103:3030/app/getDemo?id=3', {
    dataType: 'text',
    // baseUrl: 'http://192.168.40.103:3030'
})
.then( response => {
    console.log( 'response -> ', response );
})

export default fetcher;