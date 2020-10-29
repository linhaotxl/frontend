# 前端各种东西  
## 题目  
1. [实现 bind 方法](https://github.com/linhaotxl/frontend/tree/master/packages/notes/src/NativeMethod/Bind)
2. [实现 new 方法](https://github.com/linhaotxl/frontend/tree/master/packages/notes/src/NativeMethod/New)
3. [实现 instanceof 方法](https://github.com/linhaotxl/frontend/tree/master/packages/notes/src/NativeMethod/InstanceOf)   
4. [实现 compose 函数](https://github.com/linhaotxl/frontend/tree/master/packages/notes/src/Compose)
4. [实现 async](https://github.com/linhaotxl/frontend/tree/master/packages/notes/src/NativeMethod/Async)  

## 模块化  
1. [CommonJS和ESModule区别](https://github.com/linhaotxl/frontend/tree/master/packages/notes/src/Module)  

# Vue 3.0  

## reactivity  
1. [`reactive` 响应对象](#)   

2. [`ref` 响应对象]()  

3. [依赖的收集与触发]()  

## runtime-core  
1. vNode 节点  
    1. [创建各种类型的 vnode 函数](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/vnode/README.md)  
    2. [创建 vnode 的别名函数 h](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/h/README.md)  

2. [scheduler 调度](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/scheduler/README.md)  

3. 创建 App 实例  

4. 渲染器  
    1. [创建各种平台的渲染器](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/create/README.md)  

    2. 组件的渲染  
        * [组件初始化过程](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md)  
        * [组件 props 的处理](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/props/README.md)  
        * [组件 attrs 的处理](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/attrs/README.md)  
        * [组件 emits 的处理](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/emits/README.md)  
        * [组件 proxy 的处理](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/proxy/README.md)  
        * [组件更新过程](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/proxy/README.md)  
        * [组件 inject/provide 注入](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/inject/README.md)  
        * [组件 ref 处理](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/ref/README.md)  

    3. 元素的渲染  
        * [元素初始化过程](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/initial/README.md)
        * [处理 children](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md)
        * [元素更新过程](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/update/README.md)

    4. [Fragment 的渲染](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/fragment/README.md)