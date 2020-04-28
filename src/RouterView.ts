import {
  h,
  inject,
  provide,
  defineComponent,
  PropType,
  computed,
  ComponentPublicInstance,
  Component,
  warn,
  Comment,
  VNode,
  shallowRef,
  VNodeArrayChildren,
  cloneVNode,
} from 'vue'
import { RouteLocationNormalizedLoaded } from './types'
import {
  matchedRouteKey,
  viewDepthKey,
  routeLocationKey,
} from './injectionSymbols'

export const RouterView = (defineComponent({
  name: 'RouterView',
  props: {
    name: {
      type: String as PropType<string>,
      default: 'default',
    },
    route: Object as PropType<RouteLocationNormalizedLoaded>,
  },

  setup(props, { attrs, slots }) {
    const realRoute = inject(routeLocationKey)!
    const route = computed(() => props.route || realRoute)

    const depth: number = inject(viewDepthKey, 0)
    provide(viewDepthKey, depth + 1)

    const matchedRoute = computed(
      () =>
        route.value.matched[depth] as
          | RouteLocationNormalizedLoaded['matched'][any]
          | undefined
    )
    const ViewComponent = computed(
      () => matchedRoute.value && matchedRoute.value.components[props.name]
    )

    const propsData = computed(() => {
      // propsData only gets called if ViewComponent.value exists and it depends
      // on matchedRoute.value
      const { props } = matchedRoute.value!
      if (!props) return {}
      if (props === true) return route.value.params

      return typeof props === 'object' ? props : props(route.value)
    })

    provide(matchedRouteKey, matchedRoute)

    const viewRef = shallowRef<ComponentPublicInstance>()

    return () => {
      // we nee the value at the time we render because when we unmount, we
      // navigated to a different location so the value is different
      const currentMatched = matchedRoute.value
      const currentName = props.name

      function onVnodeMounted() {
        console.log('mount', currentMatched, currentName, viewRef.value)
        // usually if we mount, there is a matched record, but that's not true
        // when using the v-slot api. When dealing with transitions, they can
        // initially not render anything, so the ref can be empty. That's why we
        // add a onVnodeUpdated hook
        if (currentMatched && viewRef.value)
          currentMatched.instances[currentName] = viewRef.value
        // TODO: trigger beforeRouteEnter hooks
      }

      function onVnodeUnmounted() {
        console.log('unmount')
        if (currentMatched) {
          // remove the instance reference to prevent leak
          currentMatched.instances[currentName] = null
        }
      }

      let Component = ViewComponent.value
      const componentProps: Parameters<typeof h>[1] = {
        // only compute props if there is a matched record
        ...(Component && propsData.value),
        ...attrs,
        onVnodeMounted,
        ref: viewRef,
      }

      // NOTE: we could also not render if there is no route match
      const children =
        slots.default &&
        slots
          .default({ Component, route })
          .filter(vnode => vnode.type !== Comment)

      if (children) {
        if (__DEV__ && children.length > 1) {
          warn(
            `RouterView accepts exactly one child as its slot but it received ${children.length} children. The first child will be used while the rest will be ignored.`
          )
        }
        let child: VNode | undefined = children[0]
        if (!child) return null

        // keep alive is treated differently
        if (isKeepAlive(child)) {
          // get the inner child if we have a keep-alive
          let innerChild = getKeepAliveChild(child)
          if (!innerChild) return null
          ;(child.props = child.props || {}).onVnodeUnmounted = onVnodeUnmounted

          // we know the array exists because innerChild exists
          ;(child.children as VNodeArrayChildren)[0] = cloneVNode(
            innerChild,
            componentProps
          )
          return child
        } else {
          componentProps.onVnodeUnmounted = onVnodeUnmounted
          // to deal with initial transition with no children
          componentProps.onVnodeUpdated = componentProps.onVnodeMounted
          return cloneVNode(child, componentProps)
        }
      }

      componentProps.onVnodeUnmounted = onVnodeUnmounted

      return Component ? h(Component, componentProps) : null
    }
  },
}) as unknown) as Component

function getKeepAliveChild(vnode: VNode): VNode | undefined {
  return isKeepAlive(vnode)
    ? vnode.children
      ? ((vnode.children as VNodeArrayChildren)[0] as VNode)
      : undefined
    : vnode
}

export const isKeepAlive = (vnode: VNode): boolean =>
  (vnode.type as any).__isKeepAlive
