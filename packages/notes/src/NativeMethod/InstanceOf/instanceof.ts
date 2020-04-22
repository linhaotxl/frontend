function _instanceof ( obj: any, ctor: Function ): boolean {
    let left  = Object.getPrototypeOf( obj );
    let right = ctor.prototype;

    while ( true ) {
        if ( left === null ) {
            return false;
        }
        if ( left === right ) {
            return true;
        }
        left = Object.getPrototypeOf( left );
    }
}

function Person ( name: string, age: number ) {
    this.name = name;
    this.age  = age;
}

function Student ( name: string, age: number, score: number ) {
    Person.call( this, name, age );
    this.score = score;
}

Student.prototype = new Person( '', 0 );

export default function start () {
    const nicholas = new Person( 'nicholas', 24 );
    const iconman = new Student( 'iconman', 24, 90.0 );
    console.log( _instanceof( nicholas, Person ) );
    console.log( _instanceof( nicholas, Student ) );
    console.log( _instanceof( iconman, Person ) );
    console.log( _instanceof( iconman, Student ) );
}