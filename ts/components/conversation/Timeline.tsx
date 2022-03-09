// Copyright 2019-2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { first, get, isNumber, last, pick, throttle } from 'lodash';
import classNames from 'classnames';
import type { ReactChild, ReactNode, RefObject } from 'react';
import React from 'react';
import { createSelector } from 'reselect';
import Measure from 'react-measure';

import { ScrollDownButton } from './ScrollDownButton';

import type { AssertProps, LocalizerType, ThemeType } from '../../types/Util';
import type { ConversationType } from '../../state/ducks/conversations';
import type { PreferredBadgeSelectorType } from '../../state/selectors/badges';
import { assert, strictAssert } from '../../util/assert';
import { missingCaseError } from '../../util/missingCaseError';
import { clearTimeoutIfNecessary } from '../../util/clearTimeoutIfNecessary';
import { WidthBreakpoint } from '../_util';

import type { PropsActions as MessageActionsType } from './Message';
import type { PropsActions as UnsupportedMessageActionsType } from './UnsupportedMessage';
import type { PropsActionsType as ChatSessionRefreshedNotificationActionsType } from './ChatSessionRefreshedNotification';
import { ErrorBoundary } from './ErrorBoundary';
import type { PropsActions as SafetyNumberActionsType } from './SafetyNumberNotification';
import { Intl } from '../Intl';
import { TimelineWarning } from './TimelineWarning';
import { TimelineWarnings } from './TimelineWarnings';
import { NewlyCreatedGroupInvitedContactsDialog } from '../NewlyCreatedGroupInvitedContactsDialog';
import { ContactSpoofingType } from '../../util/contactSpoofing';
import { ContactSpoofingReviewDialog } from './ContactSpoofingReviewDialog';
import type { GroupNameCollisionsWithIdsByTitle } from '../../util/groupMemberNameCollisions';
import { hasUnacknowledgedCollisions } from '../../util/groupMemberNameCollisions';
import { TimelineFloatingHeader } from './TimelineFloatingHeader';
import {
  getWidthBreakpoint,
  UnreadIndicatorPlacement,
} from '../../util/timelineUtil';
import {
  getScrollBottom,
  scrollToBottom,
  setScrollBottom,
} from '../../util/scrollUtil';
import { LastSeenIndicator } from './LastSeenIndicator';

const AT_BOTTOM_THRESHOLD = 15;
const AT_BOTTOM_DETECTOR_STYLE = { height: AT_BOTTOM_THRESHOLD };

const MIN_ROW_HEIGHT = 18;
const SCROLL_DOWN_BUTTON_THRESHOLD = 8;

export type WarningType =
  | {
      type: ContactSpoofingType.DirectConversationWithSameTitle;
      safeConversation: ConversationType;
    }
  | {
      type: ContactSpoofingType.MultipleGroupMembersWithSameTitle;
      acknowledgedGroupNameCollisions: GroupNameCollisionsWithIdsByTitle;
      groupNameCollisions: GroupNameCollisionsWithIdsByTitle;
    };

export type ContactSpoofingReviewPropType =
  | {
      type: ContactSpoofingType.DirectConversationWithSameTitle;
      possiblyUnsafeConversation: ConversationType;
      safeConversation: ConversationType;
    }
  | {
      type: ContactSpoofingType.MultipleGroupMembersWithSameTitle;
      collisionInfoByTitle: Record<
        string,
        Array<{
          oldName?: string;
          conversation: ConversationType;
        }>
      >;
    };

export type PropsDataType = {
  haveNewest: boolean;
  haveOldest: boolean;
  isLoadingMessages: boolean;
  isNearBottom?: boolean;
  items: ReadonlyArray<string>;
  oldestUnreadIndex?: number;
  scrollToIndex?: number;
  scrollToIndexCounter: number;
  totalUnread: number;
};

type PropsHousekeepingType = {
  id: string;
  areWeAdmin?: boolean;
  isConversationSelected: boolean;
  isGroupV1AndDisabled?: boolean;
  isIncomingMessageRequest: boolean;
  isSomeoneTyping: boolean;
  unreadCount?: number;

  selectedMessageId?: string;
  invitedContactsForNewlyCreatedGroup: Array<ConversationType>;

  warning?: WarningType;
  contactSpoofingReview?: ContactSpoofingReviewPropType;

  discardMessages: (
    _: Readonly<{ conversationId: string; numberToKeepAtBottom: number }>
  ) => void;
  getTimestampForMessage: (messageId: string) => undefined | number;
  getPreferredBadge: PreferredBadgeSelectorType;
  i18n: LocalizerType;
  theme: ThemeType;

  renderItem: (props: {
    actionProps: PropsActionsType;
    containerElementRef: RefObject<HTMLElement>;
    containerWidthBreakpoint: WidthBreakpoint;
    conversationId: string;
    isOldestTimelineItem: boolean;
    messageId: string;
    nextMessageId: undefined | string;
    previousMessageId: undefined | string;
    unreadIndicatorPlacement: undefined | UnreadIndicatorPlacement;
  }) => JSX.Element;
  renderHeroRow: (
    id: string,
    unblurAvatar: () => void,
    updateSharedGroups: () => unknown
  ) => JSX.Element;
  renderTypingBubble: (id: string) => JSX.Element;
};

export type PropsActionsType = {
  acknowledgeGroupMemberNameCollisions: (
    groupNameCollisions: Readonly<GroupNameCollisionsWithIdsByTitle>
  ) => void;
  clearInvitedUuidsForNewlyCreatedGroup: () => void;
  closeContactSpoofingReview: () => void;
  setIsNearBottom: (conversationId: string, isNearBottom: boolean) => unknown;
  reviewGroupMemberNameCollision: (groupConversationId: string) => void;
  reviewMessageRequestNameCollision: (
    _: Readonly<{
      safeConversationId: string;
    }>
  ) => void;

  learnMoreAboutDeliveryIssue: () => unknown;
  loadAndScroll: (messageId: string) => unknown;
  loadOlderMessages: (messageId: string) => unknown;
  loadNewerMessages: (messageId: string) => unknown;
  loadNewestMessages: (messageId: string, setFocus?: boolean) => unknown;
  markMessageRead: (messageId: string) => unknown;
  onBlock: (conversationId: string) => unknown;
  onBlockAndReportSpam: (conversationId: string) => unknown;
  onDelete: (conversationId: string) => unknown;
  onUnblock: (conversationId: string) => unknown;
  peekGroupCallForTheFirstTime: (conversationId: string) => unknown;
  removeMember: (conversationId: string) => unknown;
  selectMessage: (messageId: string, conversationId: string) => unknown;
  clearSelectedMessage: () => unknown;
  unblurAvatar: () => void;
  updateSharedGroups: () => unknown;
} & MessageActionsType &
  SafetyNumberActionsType &
  UnsupportedMessageActionsType &
  ChatSessionRefreshedNotificationActionsType;

export type PropsType = PropsDataType &
  PropsHousekeepingType &
  PropsActionsType;

type StateType = {
  hasDismissedDirectContactSpoofingWarning: boolean;
  hasRecentlyScrolled: boolean;
  newestBottomVisibleMessageId?: string;
  oldestPartiallyVisibleMessageId?: string;
  widthBreakpoint: WidthBreakpoint;
};

const scrollToUnreadIndicator = Symbol('scrollToUnreadIndicator');

type SnapshotType =
  | null
  | typeof scrollToUnreadIndicator
  | { scrollToIndex: number }
  | { scrollTop: number }
  | { scrollBottom: number };

const getActions = createSelector(
  // It is expensive to pick so many properties out of the `props` object so we
  // use `createSelector` to memoize them by the last seen `props` object.
  (props: PropsType) => props,

  (props: PropsType): PropsActionsType => {
    const unsafe = pick(props, [
      'acknowledgeGroupMemberNameCollisions',
      'clearInvitedUuidsForNewlyCreatedGroup',
      'closeContactSpoofingReview',
      'setIsNearBottom',
      'reviewGroupMemberNameCollision',
      'reviewMessageRequestNameCollision',
      'learnMoreAboutDeliveryIssue',
      'loadAndScroll',
      'loadOlderMessages',
      'loadNewerMessages',
      'loadNewestMessages',
      'markMessageRead',
      'markViewed',
      'onBlock',
      'onBlockAndReportSpam',
      'onDelete',
      'onUnblock',
      'peekGroupCallForTheFirstTime',
      'removeMember',
      'selectMessage',
      'clearSelectedMessage',
      'unblurAvatar',
      'updateSharedGroups',

      'doubleCheckMissingQuoteReference',
      'checkForAccount',
      'reactToMessage',
      'replyToMessage',
      'retryDeleteForEveryone',
      'retrySend',
      'showForwardMessageModal',
      'deleteMessage',
      'deleteMessageForEveryone',
      'showMessageDetail',
      'openConversation',
      'showContactDetail',
      'showContactModal',
      'kickOffAttachmentDownload',
      'markAttachmentAsCorrupted',
      'messageExpanded',
      'showVisualAttachment',
      'downloadAttachment',
      'displayTapToViewMessage',
      'openLink',
      'scrollToQuotedMessage',
      'showExpiredIncomingTapToViewToast',
      'showExpiredOutgoingTapToViewToast',

      'showIdentity',

      'downloadNewVersion',

      'contactSupport',
    ]);

    const safe: AssertProps<PropsActionsType, typeof unsafe> = unsafe;

    return safe;
  }
);

export class Timeline extends React.Component<
  PropsType,
  StateType,
  SnapshotType
> {
  private readonly containerRef = React.createRef<HTMLDivElement>();
  private readonly messagesRef = React.createRef<HTMLDivElement>();
  private readonly atBottomDetectorRef = React.createRef<HTMLDivElement>();
  private readonly lastSeenIndicatorRef = React.createRef<HTMLDivElement>();
  private intersectionObserver?: IntersectionObserver;

  // This is a best guess. It will likely be overridden when the timeline is measured.
  private maxVisibleRows = Math.ceil(window.innerHeight / MIN_ROW_HEIGHT);

  private hasRecentlyScrolledTimeout?: NodeJS.Timeout;
  private delayedPeekTimeout?: NodeJS.Timeout;

  override state: StateType = {
    hasRecentlyScrolled: true,
    hasDismissedDirectContactSpoofingWarning: false,

    // This may be swiftly overridden.
    widthBreakpoint: WidthBreakpoint.Wide,
  };

  private onScroll = (): void => {
    this.setState(oldState =>
      // `onScroll` is called frequently, so it's performance-sensitive. We try our best
      //   to return `null` from this updater because [that won't cause a re-render][0].
      //
      // [0]: https://github.com/facebook/react/blob/29b7b775f2ecf878eaf605be959d959030598b07/packages/react-reconciler/src/ReactUpdateQueue.js#L401-L404
      oldState.hasRecentlyScrolled ? null : { hasRecentlyScrolled: true }
    );
    clearTimeoutIfNecessary(this.hasRecentlyScrolledTimeout);
    this.hasRecentlyScrolledTimeout = setTimeout(() => {
      this.setState({ hasRecentlyScrolled: false });
    }, 3000);
  };

  private scrollToItemIndex(itemIndex: number): void {
    this.messagesRef.current
      ?.querySelector(`[data-item-index="${itemIndex}"]`)
      ?.scrollIntoViewIfNeeded();
  }

  private scrollToBottom = (setFocus?: boolean): void => {
    const { selectMessage, id, items } = this.props;

    if (setFocus && items && items.length > 0) {
      const lastIndex = items.length - 1;
      const lastMessageId = items[lastIndex];
      selectMessage(lastMessageId, id);
    } else {
      const containerEl = this.containerRef.current;
      if (containerEl) {
        scrollToBottom(containerEl);
      }
    }
  };

  private onClickScrollDownButton = (): void => {
    this.scrollDown(false);
  };

  private scrollDown = (setFocus?: boolean): void => {
    const {
      haveNewest,
      id,
      isLoadingMessages,
      items,
      loadNewestMessages,
      oldestUnreadIndex,
      selectMessage,
    } = this.props;
    const { newestBottomVisibleMessageId } = this.state;

    if (!items || items.length < 1) {
      return;
    }

    if (isLoadingMessages) {
      this.scrollToBottom(setFocus);
      return;
    }

    if (
      newestBottomVisibleMessageId &&
      isNumber(oldestUnreadIndex) &&
      items.findIndex(item => item === newestBottomVisibleMessageId) <
        oldestUnreadIndex
    ) {
      if (setFocus) {
        const messageId = items[oldestUnreadIndex];
        selectMessage(messageId, id);
      } else {
        this.scrollToItemIndex(oldestUnreadIndex);
      }
    } else if (haveNewest) {
      this.scrollToBottom(setFocus);
    } else {
      const lastId = last(items);
      if (lastId) {
        loadNewestMessages(lastId, setFocus);
      }
    }
  };

  private isAtBottom(): boolean {
    const containerEl = this.containerRef.current;
    return Boolean(
      containerEl && getScrollBottom(containerEl) <= AT_BOTTOM_THRESHOLD
    );
  }

  private updateIntersectionObserver(): void {
    const containerEl = this.containerRef.current;
    const messagesEl = this.messagesRef.current;
    const atBottomDetectorEl = this.atBottomDetectorRef.current;
    if (!containerEl || !messagesEl || !atBottomDetectorEl) {
      return;
    }

    const {
      haveNewest,
      haveOldest,
      id,
      isLoadingMessages,
      items,
      loadNewerMessages,
      loadOlderMessages,
      setIsNearBottom,
    } = this.props;

    // We re-initialize the `IntersectionObserver`. We don't want stale references to old
    //   props, and we care about the order of `IntersectionObserverEntry`s. (We could do
    //   this another way, but this approach works.)
    this.intersectionObserver?.disconnect();

    const intersectionRatios = new Map<Element, number>();

    const intersectionObserverCallback: IntersectionObserverCallback =
      entries => {
        // The first time this callback is called, we'll get entries in observation order
        //   (which should match DOM order). We don't want to delete anything from our map
        //   because we don't want the order to change at all.
        entries.forEach(entry => {
          intersectionRatios.set(entry.target, entry.intersectionRatio);
        });

        let newIsNearBottom = false;
        let oldestPartiallyVisible: undefined | Element;
        let newestPartiallyVisible: undefined | Element;
        let newestFullyVisible: undefined | Element;

        for (const [element, intersectionRatio] of intersectionRatios) {
          if (intersectionRatio === 0) {
            continue;
          }

          // We use this "at bottom detector" for two reasons, both for performance. It's
          //   usually faster to use an `IntersectionObserver` instead of a scroll event,
          //   and we want to do that here.
          //
          // 1. We can determine whether we're near the bottom without `onScroll`
          // 2. We need this information when deciding whether the bottom of the last
          //    message is visible. We want to get an intersection observer event when the
          //    bottom of the container comes into view.
          if (element === atBottomDetectorEl) {
            newIsNearBottom = true;
          } else {
            oldestPartiallyVisible = oldestPartiallyVisible || element;
            newestPartiallyVisible = element;
            if (intersectionRatio === 1) {
              newestFullyVisible = element;
            }
          }
        }

        // If a message is fully visible, then you can see its bottom. If not, there's a
        //   very tall message around. We assume you can see the bottom of a message if
        //   (1) another message is partly visible right below it, or (2) you're near the
        //   bottom of the scrollable container.
        let newestBottomVisible: undefined | Element;
        if (newestFullyVisible) {
          newestBottomVisible = newestFullyVisible;
        } else if (
          newIsNearBottom ||
          newestPartiallyVisible !== oldestPartiallyVisible
        ) {
          newestBottomVisible = oldestPartiallyVisible;
        }

        const oldestPartiallyVisibleMessageId = getMessageIdFromElement(
          oldestPartiallyVisible
        );
        const newestBottomVisibleMessageId =
          getMessageIdFromElement(newestBottomVisible);

        this.setState({
          oldestPartiallyVisibleMessageId,
          newestBottomVisibleMessageId,
        });

        setIsNearBottom(id, newIsNearBottom);

        if (newestBottomVisibleMessageId) {
          this.markNewestBottomVisibleMessageRead();

          if (
            !isLoadingMessages &&
            !haveNewest &&
            newestBottomVisibleMessageId === last(items)
          ) {
            loadNewerMessages(newestBottomVisibleMessageId);
          }
        }

        if (
          !isLoadingMessages &&
          !haveOldest &&
          oldestPartiallyVisibleMessageId &&
          oldestPartiallyVisibleMessageId === items[0]
        ) {
          loadOlderMessages(oldestPartiallyVisibleMessageId);
        }
      };

    this.intersectionObserver = new IntersectionObserver(
      intersectionObserverCallback,
      {
        root: containerEl,
        threshold: [0, 1],
      }
    );

    for (const child of messagesEl.children) {
      if ((child as HTMLElement).dataset.messageId) {
        this.intersectionObserver.observe(child);
      }
    }
    this.intersectionObserver.observe(atBottomDetectorEl);
  }

  private markNewestBottomVisibleMessageRead = throttle(
    (): void => {
      const { markMessageRead } = this.props;
      const { newestBottomVisibleMessageId } = this.state;
      if (newestBottomVisibleMessageId) {
        markMessageRead(newestBottomVisibleMessageId);
      }
    },
    500,
    { leading: false }
  );

  public override componentDidMount(): void {
    const containerEl = this.containerRef.current;
    const messagesEl = this.messagesRef.current;
    strictAssert(
      containerEl && messagesEl,
      '<Timeline> mounted without some refs'
    );

    this.updateIntersectionObserver();

    window.registerForActive(this.markNewestBottomVisibleMessageRead);

    this.delayedPeekTimeout = setTimeout(() => {
      const { id, peekGroupCallForTheFirstTime } = this.props;
      peekGroupCallForTheFirstTime(id);
    }, 500);
  }

  public override componentWillUnmount(): void {
    const { delayedPeekTimeout } = this;

    window.unregisterForActive(this.markNewestBottomVisibleMessageRead);

    this.intersectionObserver?.disconnect();

    clearTimeoutIfNecessary(delayedPeekTimeout);
  }

  public override getSnapshotBeforeUpdate(
    prevProps: Readonly<PropsType>
  ): SnapshotType {
    const containerEl = this.containerRef.current;
    if (!containerEl) {
      return null;
    }

    const {
      isLoadingMessages: wasLoadingMessages,
      isSomeoneTyping: wasSomeoneTyping,
      items: oldItems,
      scrollToIndexCounter: oldScrollToIndexCounter,
    } = prevProps;
    const {
      isIncomingMessageRequest,
      isLoadingMessages,
      isSomeoneTyping,
      items: newItems,
      oldestUnreadIndex,
      scrollToIndex,
      scrollToIndexCounter: newScrollToIndexCounter,
    } = this.props;

    const isDoingInitialLoad = isLoadingMessages && newItems.length === 0;
    const wasDoingInitialLoad = wasLoadingMessages && oldItems.length === 0;
    const justFinishedInitialLoad = wasDoingInitialLoad && !isDoingInitialLoad;

    if (isDoingInitialLoad) {
      return null;
    }

    if (
      isNumber(scrollToIndex) &&
      (oldScrollToIndexCounter !== newScrollToIndexCounter ||
        justFinishedInitialLoad)
    ) {
      return { scrollToIndex };
    }

    if (justFinishedInitialLoad) {
      if (isIncomingMessageRequest) {
        return { scrollTop: 0 };
      }
      if (isNumber(oldestUnreadIndex)) {
        return scrollToUnreadIndicator;
      }
      return { scrollBottom: 0 };
    }

    if (isSomeoneTyping !== wasSomeoneTyping && this.isAtBottom()) {
      return { scrollBottom: 0 };
    }

    // This method assumes that item operations happen one at a time. For example, items
    //   are not added and removed in the same render pass.
    if (oldItems.length === newItems.length) {
      return null;
    }

    let scrollAnchor: 'top' | 'bottom';
    if (this.isAtBottom()) {
      const justLoadedAPage = wasLoadingMessages && !isLoadingMessages;
      scrollAnchor = justLoadedAPage ? 'top' : 'bottom';
    } else {
      scrollAnchor = last(oldItems) !== last(newItems) ? 'top' : 'bottom';
    }

    return scrollAnchor === 'top'
      ? { scrollTop: containerEl.scrollTop }
      : { scrollBottom: getScrollBottom(containerEl) };
  }

  public override componentDidUpdate(
    prevProps: Readonly<PropsType>,
    _prevState: Readonly<StateType>,
    snapshot: Readonly<SnapshotType>
  ): void {
    const { items: oldItems } = prevProps;
    const { discardMessages, id, items: newItems } = this.props;

    const containerEl = this.containerRef.current;
    if (containerEl && snapshot) {
      if (snapshot === scrollToUnreadIndicator) {
        const lastSeenIndicatorEl = this.lastSeenIndicatorRef.current;
        if (lastSeenIndicatorEl) {
          lastSeenIndicatorEl.scrollIntoView();
        } else {
          scrollToBottom(containerEl);
          assert(
            false,
            '<Timeline> expected a last seen indicator but it was not found'
          );
        }
      } else if ('scrollToIndex' in snapshot) {
        this.scrollToItemIndex(snapshot.scrollToIndex);
      } else if ('scrollTop' in snapshot) {
        containerEl.scrollTop = snapshot.scrollTop;
      } else {
        setScrollBottom(containerEl, snapshot.scrollBottom);
      }
    }

    if (oldItems.length !== newItems.length) {
      this.updateIntersectionObserver();

      // This condition is somewhat arbitrary.
      const shouldDiscardOlderMessages: boolean =
        this.isAtBottom() && newItems.length >= this.maxVisibleRows * 1.5;
      if (shouldDiscardOlderMessages) {
        discardMessages({
          conversationId: id,
          numberToKeepAtBottom: this.maxVisibleRows,
        });
      }
    }
  }

  private handleBlur = (event: React.FocusEvent): void => {
    const { clearSelectedMessage } = this.props;

    const { currentTarget } = event;

    // Thanks to https://gist.github.com/pstoica/4323d3e6e37e8a23dd59
    setTimeout(() => {
      // If focus moved to one of our portals, we do not clear the selected
      // message so that focus stays inside the portal. We need to be careful
      // to not create colliding keyboard shortcuts between selected messages
      // and our portals!
      const portals = Array.from(
        document.querySelectorAll('body > div:not(.inbox)')
      );
      if (portals.some(el => el.contains(document.activeElement))) {
        return;
      }

      if (!currentTarget.contains(document.activeElement)) {
        clearSelectedMessage();
      }
    }, 0);
  };

  private handleKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ): void => {
    const { selectMessage, selectedMessageId, items, id } = this.props;
    const commandKey = get(window, 'platform') === 'darwin' && event.metaKey;
    const controlKey = get(window, 'platform') !== 'darwin' && event.ctrlKey;
    const commandOrCtrl = commandKey || controlKey;

    if (!items || items.length < 1) {
      return;
    }

    if (selectedMessageId && !commandOrCtrl && event.key === 'ArrowUp') {
      const selectedMessageIndex = items.findIndex(
        item => item === selectedMessageId
      );
      if (selectedMessageIndex < 0) {
        return;
      }

      const targetIndex = selectedMessageIndex - 1;
      if (targetIndex < 0) {
        return;
      }

      const messageId = items[targetIndex];
      selectMessage(messageId, id);

      event.preventDefault();
      event.stopPropagation();

      return;
    }

    if (selectedMessageId && !commandOrCtrl && event.key === 'ArrowDown') {
      const selectedMessageIndex = items.findIndex(
        item => item === selectedMessageId
      );
      if (selectedMessageIndex < 0) {
        return;
      }

      const targetIndex = selectedMessageIndex + 1;
      if (targetIndex >= items.length) {
        return;
      }

      const messageId = items[targetIndex];
      selectMessage(messageId, id);

      event.preventDefault();
      event.stopPropagation();

      return;
    }

    if (commandOrCtrl && event.key === 'ArrowUp') {
      const firstMessageId = first(items);
      if (firstMessageId) {
        selectMessage(firstMessageId, id);
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (commandOrCtrl && event.key === 'ArrowDown') {
      this.scrollDown(true);
      event.preventDefault();
      event.stopPropagation();
    }
  };

  public override render(): JSX.Element | null {
    const {
      acknowledgeGroupMemberNameCollisions,
      areWeAdmin,
      clearInvitedUuidsForNewlyCreatedGroup,
      closeContactSpoofingReview,
      contactSpoofingReview,
      getPreferredBadge,
      getTimestampForMessage,
      haveNewest,
      haveOldest,
      i18n,
      id,
      invitedContactsForNewlyCreatedGroup,
      isConversationSelected,
      isGroupV1AndDisabled,
      isLoadingMessages,
      isSomeoneTyping,
      items,
      oldestUnreadIndex,
      onBlock,
      onBlockAndReportSpam,
      onDelete,
      onUnblock,
      removeMember,
      renderHeroRow,
      renderItem,
      renderTypingBubble,
      reviewGroupMemberNameCollision,
      reviewMessageRequestNameCollision,
      showContactModal,
      theme,
      totalUnread,
      unblurAvatar,
      unreadCount,
      updateSharedGroups,
    } = this.props;
    const {
      hasRecentlyScrolled,
      newestBottomVisibleMessageId,
      oldestPartiallyVisibleMessageId,
      widthBreakpoint,
    } = this.state;

    // As a performance optimization, we don't need to render anything if this
    //   conversation isn't the active one.
    if (!isConversationSelected) {
      return null;
    }

    const areThereAnyMessages = items.length > 0;
    const areAnyMessagesUnread = Boolean(unreadCount);
    const areAnyMessagesBelowCurrentPosition =
      !haveNewest ||
      Boolean(
        newestBottomVisibleMessageId &&
          newestBottomVisibleMessageId !== last(items)
      );
    const areSomeMessagesBelowCurrentPosition =
      !haveNewest ||
      (newestBottomVisibleMessageId &&
        !items
          .slice(-SCROLL_DOWN_BUTTON_THRESHOLD)
          .includes(newestBottomVisibleMessageId));

    const areUnreadBelowCurrentPosition = Boolean(
      areThereAnyMessages &&
        areAnyMessagesUnread &&
        areAnyMessagesBelowCurrentPosition
    );
    const shouldShowScrollDownButton = Boolean(
      areThereAnyMessages &&
        (areUnreadBelowCurrentPosition || areSomeMessagesBelowCurrentPosition)
    );

    const actionProps = getActions(this.props);

    let floatingHeader: ReactNode;
    // It's possible that a message was removed from `items` but we still have its ID in
    //   state. `getTimestampForMessage` might return undefined in that case.
    const oldestPartiallyVisibleMessageTimestamp =
      oldestPartiallyVisibleMessageId
        ? getTimestampForMessage(oldestPartiallyVisibleMessageId)
        : undefined;
    if (
      oldestPartiallyVisibleMessageId &&
      oldestPartiallyVisibleMessageTimestamp
    ) {
      floatingHeader = (
        <TimelineFloatingHeader
          i18n={i18n}
          isLoading={isLoadingMessages}
          timestamp={oldestPartiallyVisibleMessageTimestamp}
          visible={
            (hasRecentlyScrolled || isLoadingMessages) &&
            (!haveOldest || oldestPartiallyVisibleMessageId !== items[0])
          }
        />
      );
    }

    const messageNodes: Array<ReactChild> = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const previousItemIndex = itemIndex - 1;
      const nextItemIndex = itemIndex + 1;

      const previousMessageId: undefined | string = items[previousItemIndex];
      const nextMessageId: undefined | string = items[nextItemIndex];
      const messageId = items[itemIndex];

      if (!messageId) {
        assert(
          false,
          '<Timeline> iterated through items and got an empty message ID'
        );
        continue;
      }

      let unreadIndicatorPlacement: undefined | UnreadIndicatorPlacement;
      if (oldestUnreadIndex === itemIndex) {
        unreadIndicatorPlacement = UnreadIndicatorPlacement.JustAbove;
        messageNodes.push(
          <LastSeenIndicator
            key="last seen indicator"
            count={totalUnread}
            i18n={i18n}
            ref={this.lastSeenIndicatorRef}
          />
        );
      } else if (oldestUnreadIndex === nextItemIndex) {
        unreadIndicatorPlacement = UnreadIndicatorPlacement.JustBelow;
      }

      messageNodes.push(
        <div
          key={messageId}
          data-item-index={itemIndex}
          data-message-id={messageId}
        >
          <ErrorBoundary i18n={i18n} showDebugLog={showDebugLog}>
            {renderItem({
              actionProps,
              containerElementRef: this.containerRef,
              containerWidthBreakpoint: widthBreakpoint,
              conversationId: id,
              isOldestTimelineItem: haveOldest && itemIndex === 0,
              messageId,
              nextMessageId,
              previousMessageId,
              unreadIndicatorPlacement,
            })}
          </ErrorBoundary>
        </div>
      );
    }

    const warning = Timeline.getWarning(this.props, this.state);
    let timelineWarning: ReactNode;
    if (warning) {
      let text: ReactChild;
      let onClose: () => void;
      switch (warning.type) {
        case ContactSpoofingType.DirectConversationWithSameTitle:
          text = (
            <Intl
              i18n={i18n}
              id="ContactSpoofing__same-name"
              components={{
                link: (
                  <TimelineWarning.Link
                    onClick={() => {
                      reviewMessageRequestNameCollision({
                        safeConversationId: warning.safeConversation.id,
                      });
                    }}
                  >
                    {i18n('ContactSpoofing__same-name__link')}
                  </TimelineWarning.Link>
                ),
              }}
            />
          );
          onClose = () => {
            this.setState({
              hasDismissedDirectContactSpoofingWarning: true,
            });
          };
          break;
        case ContactSpoofingType.MultipleGroupMembersWithSameTitle: {
          const { groupNameCollisions } = warning;
          text = (
            <Intl
              i18n={i18n}
              id="ContactSpoofing__same-name-in-group"
              components={{
                count: Object.values(groupNameCollisions)
                  .reduce(
                    (result, conversations) => result + conversations.length,
                    0
                  )
                  .toString(),
                link: (
                  <TimelineWarning.Link
                    onClick={() => {
                      reviewGroupMemberNameCollision(id);
                    }}
                  >
                    {i18n('ContactSpoofing__same-name-in-group__link')}
                  </TimelineWarning.Link>
                ),
              }}
            />
          );
          onClose = () => {
            acknowledgeGroupMemberNameCollisions(groupNameCollisions);
          };
          break;
        }
        default:
          throw missingCaseError(warning);
      }

      timelineWarning = (
        <TimelineWarnings>
          <TimelineWarning i18n={i18n} onClose={onClose}>
            <TimelineWarning.IconContainer>
              <TimelineWarning.GenericIcon />
            </TimelineWarning.IconContainer>
            <TimelineWarning.Text>{text}</TimelineWarning.Text>
          </TimelineWarning>
        </TimelineWarnings>
      );
    }

    let contactSpoofingReviewDialog: ReactNode;
    if (contactSpoofingReview) {
      const commonProps = {
        getPreferredBadge,
        i18n,
        onBlock,
        onBlockAndReportSpam,
        onClose: closeContactSpoofingReview,
        onDelete,
        onShowContactModal: showContactModal,
        onUnblock,
        removeMember,
        theme,
      };

      switch (contactSpoofingReview.type) {
        case ContactSpoofingType.DirectConversationWithSameTitle:
          contactSpoofingReviewDialog = (
            <ContactSpoofingReviewDialog
              {...commonProps}
              type={ContactSpoofingType.DirectConversationWithSameTitle}
              possiblyUnsafeConversation={
                contactSpoofingReview.possiblyUnsafeConversation
              }
              safeConversation={contactSpoofingReview.safeConversation}
            />
          );
          break;
        case ContactSpoofingType.MultipleGroupMembersWithSameTitle:
          contactSpoofingReviewDialog = (
            <ContactSpoofingReviewDialog
              {...commonProps}
              type={ContactSpoofingType.MultipleGroupMembersWithSameTitle}
              areWeAdmin={Boolean(areWeAdmin)}
              collisionInfoByTitle={contactSpoofingReview.collisionInfoByTitle}
            />
          );
          break;
        default:
          throw missingCaseError(contactSpoofingReview);
      }
    }

    return (
      <>
        <Measure
          bounds
          onResize={({ bounds }) => {
            const { isNearBottom } = this.props;

            strictAssert(bounds, 'We should be measuring the bounds');

            this.setState({
              widthBreakpoint: getWidthBreakpoint(bounds.width),
            });

            this.maxVisibleRows = Math.ceil(bounds.height / MIN_ROW_HEIGHT);

            const containerEl = this.containerRef.current;
            if (containerEl && isNearBottom) {
              scrollToBottom(containerEl);
            }
          }}
        >
          {({ measureRef }) => (
            <div
              className={classNames(
                'module-timeline',
                isGroupV1AndDisabled ? 'module-timeline--disabled' : null,
                `module-timeline--width-${widthBreakpoint}`
              )}
              role="presentation"
              tabIndex={-1}
              onBlur={this.handleBlur}
              onKeyDown={this.handleKeyDown}
              ref={measureRef}
            >
              {timelineWarning}

              <div
                className="module-timeline__messages__container"
                onScroll={this.onScroll}
                ref={this.containerRef}
              >
                {floatingHeader}

                <div
                  className={classNames(
                    'module-timeline__messages',
                    haveNewest && 'module-timeline__messages--have-newest'
                  )}
                  ref={this.messagesRef}
                >
                  {haveOldest &&
                    renderHeroRow(id, unblurAvatar, updateSharedGroups)}

                  {messageNodes}

                  {isSomeoneTyping && renderTypingBubble(id)}

                  <div
                    className="module-timeline__messages__at-bottom-detector"
                    ref={this.atBottomDetectorRef}
                    style={AT_BOTTOM_DETECTOR_STYLE}
                  />
                </div>
              </div>

              {shouldShowScrollDownButton ? (
                <ScrollDownButton
                  conversationId={id}
                  withNewMessages={areUnreadBelowCurrentPosition}
                  scrollDown={this.onClickScrollDownButton}
                  i18n={i18n}
                />
              ) : null}
            </div>
          )}
        </Measure>

        {Boolean(invitedContactsForNewlyCreatedGroup.length) && (
          <NewlyCreatedGroupInvitedContactsDialog
            contacts={invitedContactsForNewlyCreatedGroup}
            getPreferredBadge={getPreferredBadge}
            i18n={i18n}
            onClose={clearInvitedUuidsForNewlyCreatedGroup}
            theme={theme}
          />
        )}

        {contactSpoofingReviewDialog}
      </>
    );
  }

  private static getWarning(
    { warning }: PropsType,
    state: StateType
  ): undefined | WarningType {
    if (!warning) {
      return undefined;
    }

    switch (warning.type) {
      case ContactSpoofingType.DirectConversationWithSameTitle: {
        const { hasDismissedDirectContactSpoofingWarning } = state;
        return hasDismissedDirectContactSpoofingWarning ? undefined : warning;
      }
      case ContactSpoofingType.MultipleGroupMembersWithSameTitle:
        return hasUnacknowledgedCollisions(
          warning.acknowledgedGroupNameCollisions,
          warning.groupNameCollisions
        )
          ? warning
          : undefined;
      default:
        throw missingCaseError(warning);
    }
  }
}

function getMessageIdFromElement(
  element: undefined | Element
): undefined | string {
  return element instanceof HTMLElement ? element.dataset.messageId : undefined;
}

function showDebugLog() {
  window.showDebugLog();
}
