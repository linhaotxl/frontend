<!-- TOC -->

- [是否是闭合标签](#是否是闭合标签)
- [是否原生标签](#是否原生标签)
- [解码实体字符](#解码实体字符)
- [是否是平台组件](#是否是平台组件)
- [命名空间](#命名空间)
- [文本解析模式](#文本解析模式)

<!-- /TOC -->

浏览器平台下的解析，流程还是和以前一样，唯一不同的就是配置，接下来主要来看配置都发生了什么变化  

```ts
export const parserOptions: ParserOptions = {
    isVoidTag,
    isNativeTag: tag => isHTMLTag(tag) || isSVGTag(tag),
    isPreTag: tag => tag === 'pre',
    decodeEntities: __BROWSER__ ? decodeHtmlBrowser : decodeHtml,

    isBuiltInComponent: (tag: string): symbol | undefined => {
        if (isBuiltInType(tag, `Transition`)) {
        return TRANSITION
        } else if (isBuiltInType(tag, `TransitionGroup`)) {
        return TRANSITION_GROUP
        }
    },

    getNamespace: () {},

    getTextMode: () {},
}
```  

先来看几个简单的配置，最后两个都和 `namespace` 有关，最后再看  


## 是否是闭合标签  
源码中将所有的闭合标签都列了出来，并将它们合成为一个对象，值为 `true`，用来检测  

```ts
const VOID_TAGS = 'area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr'
export const isVoidTag = /*#__PURE__*/ makeMap(VOID_TAGS)
```  

## 是否原生标签  
原生标签分两种  
1. 普通 `HTML` 标签  
2. `SVG` 里的标签  

源码中也是将它们都列了出来，并标记为对象  

```ts
const HTML_TAGS =
    'html,body,base,head,link,meta,style,title,address,article,aside,footer,' +
    'header,h1,h2,h3,h4,h5,h6,hgroup,nav,section,div,dd,dl,dt,figcaption,' +
    'figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,' +
    'data,dfn,em,i,kbd,mark,q,rp,rt,rtc,ruby,s,samp,small,span,strong,sub,sup,' +
    'time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,' +
    'canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,' +
    'th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,' +
    'option,output,progress,select,textarea,details,dialog,menu,' +
    'summary,template,blockquote,iframe,tfoot'

const SVG_TAGS =
    'svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,' +
    'defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,' +
    'feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,' +
    'feDistanceLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,' +
    'feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,' +
    'fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,' +
    'foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,' +
    'mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,' +
    'polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,' +
    'text,textPath,title,tspan,unknown,use,view'

export const isHTMLTag = /*#__PURE__*/ makeMap(HTML_TAGS)
export const isSVGTag = /*#__PURE__*/ makeMap(SVG_TAGS)
```  

## 解码实体字符  
至于解码实体字符，其实是通过浏览器的功能来完成的  
创建空的容器，将原始内容存入，这时候浏览器会将原始内容自动转换  

```ts
let decoder: HTMLDivElement

export function decodeHtmlBrowser(raw: string): string {
    ;(decoder || (decoder = document.createElement('div'))).innerHTML = raw
    return decoder.textContent as string
}
```  

## 是否是平台组件  
浏览器下的内置组件只有两个，`transition` 和 `transition-group`，所以只需要判断这两个即可  

```ts
isBuiltInComponent: (tag: string): symbol | undefined => {
    if (isBuiltInType(tag, `Transition`)) {
        return TRANSITION
    } else if (isBuiltInType(tag, `TransitionGroup`)) {
        return TRANSITION_GROUP
    }
}
```  

## 命名空间  
命名空间总共有三种  

```ts
export const enum DOMNamespaces {
    HTML = Namespaces.HTML, // 除以下两种外剩下所有的标签都属于 HTML 命名空间
    SVG,                    // svg 标签标识为 SVG 命名空间
    MATH_ML                 // math 标签标志为 MATH_ML 命名空间
}
```  

还存在一些其他情况，例如在 `svg` 或 `math` 中，出现了一些其他的标签，这个时候命名空间会发生变化  
因为情况比较多，直接看代码  

```ts
getNamespace(tag: string, parent: ElementNode | undefined): DOMNamespaces {
    // 1. 存在父节点，就用父节点的，否则初始化为 HTML
    let ns = parent ? parent.ns : DOMNamespaces.HTML

    // 2. 处理在 math 标签内
    if (parent && ns === DOMNamespaces.MATH_ML) {
        // 2.1 处理父元素是 annotation-xml 的情况
        if (parent.tag === 'annotation-xml') {
            // 2.1.1 当前元素是 svg，则会直接使用 SVG 命名空间
            if (tag === 'svg') {
                return DOMNamespaces.SVG
            }
            // 2.1.2 父元素存在 encoding 属性，且值是 text/html 或 application/xhtml+xml，使用 HTML 命名空间
            if (
                parent.props.some(
                    a =>
                    a.type === NodeTypes.ATTRIBUTE &&
                    a.name === 'encoding' &&
                    a.value != null &&
                    (a.value.content === 'text/html' || a.value.content === 'application/xhtml+xml')
                )
            ) {
                ns = DOMNamespaces.HTML
            }
        }
        // 2.2 父元素是 mtext、mi、mo、mn、ms 中的任意一个，则使用 HTML 命名空间
        else if (
            /^m(?:[ions]|text)$/.test(parent.tag) &&
            tag !== 'mglyph' &&
            tag !== 'malignmark'
        ) {
            ns = DOMNamespaces.HTML
        }
    }
    // 3. 处在 svg 中，如果父元素是 foreignObject、desc、title 中的一个，则使用 HTML 命名空间
    else if (parent && ns === DOMNamespaces.SVG) {
        if (
            parent.tag === 'foreignObject' ||
            parent.tag === 'desc' ||
            parent.tag === 'title'
        ) {
            ns = DOMNamespaces.HTML
        }
    }

    // 4. 处理当前在 HTML 下的情况，对 svg 和 math 初始化就是在这种情况下发生的
    if (ns === DOMNamespaces.HTML) {
        if (tag === 'svg') {
            return DOMNamespaces.SVG
        }
        if (tag === 'math') {
            return DOMNamespaces.MATH_ML
        }
    }

    // 5. 返回命名空间
    return ns;
}
```  

接下来对上面各种情况依次举例  

```html
<!-- HTML -->
<html>test</html>
<!-- SVG -->
<svg>test</svg>
<!-- MATH -->
<math>test</math>

<!-- 步骤 2.1.1 -->
<math><annotation-xml><svg></svg></annotation-xml></math>

<!-- 步骤 2.1.2 -->
<math><annotation-xml encoding="text/html"><test /></annotation-xml></math>

<!-- 步骤 2.2 -->
<math><mtext><malignmark /></mtext></math>
<math><mtext><test /></mtext></math>

<!-- 步骤 3 -->
<svg><foreignObject><test /></foreignObject></svg>

<!-- 步骤 4 -->
<html><svg></svg></html>
<html><math></math></html>
```  

## 文本解析模式  

```ts
getTextMode({ tag, ns }: ElementNode): TextModes {
    // 1. 只会处理 HTML 命名空间下的标签
    if (ns === DOMNamespaces.HTML) {
        // textarea 和 title 采用 RCDATA 模式
        if (tag === 'textarea' || tag === 'title') {
            return TextModes.RCDATA
        }
        // 显示原始本文的标签采用 RAWTEXT
        if (isRawTextContainer(tag)) {
            return TextModes.RAWTEXT
        }
    }
    // 2. 剩余所有都采用普通的 DATA
    return TextModes.DATA
}
```  

需要显示原始文本的标签有以下几个  

```ts
const isRawTextContainer = /*#__PURE__*/ makeMap(
    'style,iframe,script,noscript',
    true
)
```  

