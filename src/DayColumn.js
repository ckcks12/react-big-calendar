import PropTypes from 'prop-types'
import React from 'react'
import { findDOMNode } from 'react-dom'
import cn from 'classnames'

import Selection, { getBoundsForNode, isEvent } from './Selection'
import * as dates from './utils/dates'
import * as TimeSlotUtils from './utils/TimeSlots'
import { isSelected } from './utils/selection'

import { notify } from './utils/helpers'
import * as DayEventLayout from './utils/DayEventLayout'
import TimeSlotGroup from './TimeSlotGroup'
import TimeGridEvent from './TimeGridEvent'

class DayColumn extends React.Component {
  state = { selecting: false, timeIndicatorPosition: null }

  constructor(...args) {
    super(...args)

    this.slotMetrics = TimeSlotUtils.getSlotMetrics(this.props)
  }

  componentDidMount() {
    this.props.selectable && this._selectable()

    if (this.props.isNow) {
      this.setTimeIndicatorPositionUpdateInterval()
    }
  }

  componentWillUnmount() {
    this._teardownSelectable()
    this.clearTimeIndicatorInterval()
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.selectable && !this.props.selectable) this._selectable()
    if (!nextProps.selectable && this.props.selectable)
      this._teardownSelectable()

    this.slotMetrics = this.slotMetrics.update(nextProps)
  }

  componentDidUpdate(prevProps, prevState) {
    const getNowChanged = !dates.eq(
      prevProps.getNow(),
      this.props.getNow(),
      'minutes'
    )

    if (prevProps.isNow !== this.props.isNow || getNowChanged) {
      this.clearTimeIndicatorInterval()

      if (this.props.isNow) {
        const tail =
          !getNowChanged &&
          dates.eq(prevProps.date, this.props.date, 'minutes') &&
          prevState.timeIndicatorPosition === this.state.timeIndicatorPosition

        this.setTimeIndicatorPositionUpdateInterval(tail)
      }
    } else if (
      this.props.isNow &&
      (!dates.eq(prevProps.min, this.props.min, 'minutes') ||
        !dates.eq(prevProps.max, this.props.max, 'minutes'))
    ) {
      this.positionTimeIndicator()
    }
  }

  intervalTriggered = false
  /**
   * @param tail {Boolean} - whether `positionTimeIndicator` call should be
   *   deferred or called upon setting interval (`true` - if deferred);
   */
  setTimeIndicatorPositionUpdateInterval(tail = false) {
    if (!this.intervalTriggered && !tail) {
      this.positionTimeIndicator()
    }

    this._timeIndicatorTimeout = window.setTimeout(() => {
      this.intervalTriggered = true
      this.positionTimeIndicator()
      this.setTimeIndicatorPositionUpdateInterval()
    }, 60000)
  }

  clearTimeIndicatorInterval() {
    this.intervalTriggered = false
    window.clearTimeout(this._timeIndicatorTimeout)
  }

  positionTimeIndicator() {
    const { min, max, getNow } = this.props
    const current = getNow()

    if (current >= min && current <= max) {
      const { top } = this.slotMetrics.getRange(current, current)
      this.setState({ timeIndicatorPosition: top })
    } else {
      this.clearTimeIndicatorInterval()
    }
  }

  render() {
    const {
      max,
      rtl,
      isNow,
      resource,
      accessors,
      localizer,
      getters: { dayProp, ...getters },
      components: { eventContainerWrapper: EventContainer, ...components },
    } = this.props

    let { slotMetrics } = this
    let { selecting, top, height, startDate, endDate } = this.state

    let selectDates = { start: startDate, end: endDate }

    const { className, style } = dayProp(max)

    return (
      <div
        style={style}
        className={cn(
          className,
          'rbc-day-slot',
          'rbc-time-column',
          isNow && 'rbc-now',
          isNow && 'rbc-today', // WHY
          selecting && 'rbc-slot-selecting'
        )}
      >
        {slotMetrics.groups.map((grp, idx) => (
          <TimeSlotGroup
            key={idx}
            group={grp}
            resource={resource}
            getters={getters}
            components={components}
          />
        ))}
        <EventContainer
          localizer={localizer}
          resource={resource}
          accessors={accessors}
          getters={getters}
          components={components}
          slotMetrics={slotMetrics}
        >
          <div className={cn('rbc-events-container', rtl && 'rtl')}>
            {this.renderEvents()}
          </div>
        </EventContainer>

        {selecting && (
          <div className="rbc-slot-selection" style={{ top, height }}>
            <span>{localizer.format(selectDates, 'selectRangeFormat')}</span>
          </div>
        )}
        {isNow && (
          <div
            className="rbc-current-time-indicator"
            style={{ top: `${this.state.timeIndicatorPosition}%` }}
          />
        )}
      </div>
    )
  }

  renderEvents = () => {
    let {
      events,
      rtl,
      selected,
      accessors,
      localizer,
      getters,
      components,
      step,
      timeslots,
    } = this.props

    const { slotMetrics } = this
    const { messages } = localizer

    let styledEvents = DayEventLayout.getStyledEvents({
      events,
      accessors,
      slotMetrics,
      minimumStartDifference: Math.ceil((step * timeslots) / 2),
    })

    /**
     * Cusotmization starts
     */
    styledEvents.sort((a, b) => {
      a = a.style
      b = b.style
      if (a.top !== b.top)
        return a.top > b.top ? 1 : -1
      else
        return a.top + a.height < b.top + b.height ? 1 : -1
    })

    styledEvents.map((se) => {
      se.friends = []
      delete se.style.left
      delete se.style.width
      delete se.idx // virtual left
      delete se.size // virtual width
    })

    for (let i=0; i<styledEvents.length; ++i) {
      const se1 = styledEvents[i]
      const y1 = se1.style.top
      const y2 = se1.style.top + se1.style.height

      for (let j=i+1; j<styledEvents.length; ++j) {
        const se2 = styledEvents[j]
        const y3 = se2.style.top
        const y4 = se2.style.top + se2.style.height

        // 두 이벤트가 겹칠때
        if ((y3 <= y1 && y1 < y4)
            || (y1 <= y3 && y3 < y2)) {
          se1.friends.push(se2)
          se2.friends.push(se1)
        }
      }
    }

    for (let i=0; i<styledEvents.length; ++i) {
      const se = styledEvents[i]
      const bitmap = []
      for (let j=0; j<100; ++j)
        bitmap.push(1); // 1 means available

      se.friends.forEach((f) => {
        const idx = f.idx
        if (idx === undefined) return
        bitmap[idx] = 0 // 0 means reserved
      })

      se.idx = bitmap.indexOf(1)
    }

    function dfs(node, maxIdx, visited) {
      node.friends.forEach((f) => {
        if (visited.indexOf(f) > -1) return
        maxIdx = Math.max(maxIdx, f.idx)
        visited.push(f)
        maxIdx = Math.max(maxIdx, dfs(f, maxIdx, visited))
      })
      return maxIdx
    }

    styledEvents.map((se) => {
      let size = 0
      let maxIdx = 0

      if (se.size) return

      const allFriends = []
      maxIdx = dfs(se, 0, allFriends)
      size = 100 / (maxIdx + 1)
      se.size = size

      allFriends.map((f) => f.size = size)
    })

    styledEvents.map((se) => {
      se.style.left = se.idx * se.size

      // stretch to maximum
      let maxIdx = 0
      se.friends.forEach((f) => maxIdx = Math.max(maxIdx, f.idx))
      if (maxIdx <= se.idx) {
        se.size = 100 - (se.idx * se.size)
      }

      // padding between events
      // for this feature, `width` is not percentage based unit anymore
      // it will be used with calc()
      const padding = se.idx === 0 ? 0 : 3
      se.style.width = `calc(${se.size}% - ${padding}px)`
      se.style.marginLeft = padding
    })

    return styledEvents.map(({ event, style }, idx) => {
      let end = accessors.end(event)
      let start = accessors.start(event)
      let format = 'eventTimeRangeFormat'
      let label

      const startsBeforeDay = slotMetrics.startsBeforeDay(start)
      const startsAfterDay = slotMetrics.startsAfterDay(end)

      if (startsBeforeDay) format = 'eventTimeRangeEndFormat'
      else if (startsAfterDay) format = 'eventTimeRangeStartFormat'

      if (startsBeforeDay && startsAfterDay) label = messages.allDay
      else label = localizer.format({ start, end }, format)

      let continuesEarlier = startsBeforeDay || slotMetrics.startsBefore(start)
      let continuesLater = startsAfterDay || slotMetrics.startsAfter(end)

      return (
        <TimeGridEvent
          style={style}
          event={event}
          label={label}
          key={'evt_' + idx}
          getters={getters}
          rtl={rtl}
          components={components}
          continuesEarlier={continuesEarlier}
          continuesLater={continuesLater}
          accessors={accessors}
          selected={isSelected(event, selected)}
          onClick={e => this._select(event, e)}
          onDoubleClick={e => this._doubleClick(event, e)}
        />
      )
    })
  }

  _selectable = () => {
    let node = findDOMNode(this)
    let selector = (this._selector = new Selection(() => findDOMNode(this), {
      longPressThreshold: this.props.longPressThreshold,
    }))

    let maybeSelect = box => {
      let onSelecting = this.props.onSelecting
      let current = this.state || {}
      let state = selectionState(box)
      let { startDate: start, endDate: end } = state

      if (onSelecting) {
        if (
          (dates.eq(current.startDate, start, 'minutes') &&
            dates.eq(current.endDate, end, 'minutes')) ||
          onSelecting({ start, end }) === false
        )
          return
      }

      if (
        this.state.start !== state.start ||
        this.state.end !== state.end ||
        this.state.selecting !== state.selecting
      ) {
        this.setState(state)
      }
    }

    let selectionState = point => {
      let currentSlot = this.slotMetrics.closestSlotFromPoint(
        point,
        getBoundsForNode(node)
      )

      if (!this.state.selecting) this._initialSlot = currentSlot

      let initialSlot = this._initialSlot
      if (initialSlot === currentSlot)
        currentSlot = this.slotMetrics.nextSlot(initialSlot)

      const selectRange = this.slotMetrics.getRange(
        dates.min(initialSlot, currentSlot),
        dates.max(initialSlot, currentSlot)
      )

      return {
        ...selectRange,
        selecting: true,

        top: `${selectRange.top}%`,
        height: `${selectRange.height}%`,
      }
    }

    let selectorClicksHandler = (box, actionType) => {
      if (!isEvent(findDOMNode(this), box)) {
        const { startDate, endDate } = selectionState(box)
        this._selectSlot({
          startDate,
          endDate,
          action: actionType,
          box,
        })
      }
      this.setState({ selecting: false })
    }

    selector.on('selecting', maybeSelect)
    selector.on('selectStart', maybeSelect)

    selector.on('beforeSelect', box => {
      if (this.props.selectable !== 'ignoreEvents') return

      return !isEvent(findDOMNode(this), box)
    })

    selector.on('click', box => selectorClicksHandler(box, 'click'))

    selector.on('doubleClick', box => selectorClicksHandler(box, 'doubleClick'))

    selector.on('select', bounds => {
      if (this.state.selecting) {
        this._selectSlot({ ...this.state, action: 'select', bounds })
        this.setState({ selecting: false })
      }
    })

    selector.on('reset', () => {
      if (this.state.selecting) {
        this.setState({ selecting: false })
      }
    })
  }

  _teardownSelectable = () => {
    if (!this._selector) return
    this._selector.teardown()
    this._selector = null
  }

  _selectSlot = ({ startDate, endDate, action, bounds, box }) => {
    let current = startDate,
      slots = []

    while (dates.lte(current, endDate)) {
      slots.push(current)
      current = dates.add(current, this.props.step, 'minutes')
    }

    notify(this.props.onSelectSlot, {
      slots,
      start: startDate,
      end: endDate,
      resourceId: this.props.resource,
      action,
      bounds,
      box,
    })
  }

  _select = (...args) => {
    notify(this.props.onSelectEvent, args)
  }

  _doubleClick = (...args) => {
    notify(this.props.onDoubleClickEvent, args)
  }
}

DayColumn.propTypes = {
  events: PropTypes.array.isRequired,
  step: PropTypes.number.isRequired,
  date: PropTypes.instanceOf(Date).isRequired,
  min: PropTypes.instanceOf(Date).isRequired,
  max: PropTypes.instanceOf(Date).isRequired,
  getNow: PropTypes.func.isRequired,
  isNow: PropTypes.bool,

  rtl: PropTypes.bool,

  accessors: PropTypes.object.isRequired,
  components: PropTypes.object.isRequired,
  getters: PropTypes.object.isRequired,
  localizer: PropTypes.object.isRequired,

  showMultiDayTimes: PropTypes.bool,
  culture: PropTypes.string,
  timeslots: PropTypes.number,

  selected: PropTypes.object,
  selectable: PropTypes.oneOf([true, false, 'ignoreEvents']),
  eventOffset: PropTypes.number,
  longPressThreshold: PropTypes.number,

  onSelecting: PropTypes.func,
  onSelectSlot: PropTypes.func.isRequired,
  onSelectEvent: PropTypes.func.isRequired,
  onDoubleClickEvent: PropTypes.func.isRequired,

  className: PropTypes.string,
  dragThroughEvents: PropTypes.bool,
  resource: PropTypes.any,
}

DayColumn.defaultProps = {
  dragThroughEvents: true,
  timeslots: 2,
}

export default DayColumn
