import Fetcher from './src/core/Fetcher';

const fetcher = new Fetcher();

fetcher.post( 'http://localhost:3010/api/app', {
    dataType: 'json'
})
.then( response => {
    console.log( 'response -> ', response );
})