import { state } from '../globals.js';
import {
  bubbleUncheck,
  createTreeNode
} from './user-access/tree-node.js';
import {
  renderLibraryAccessTree,
  loadLibraryTreeAndUserAccess,
  toggleAllAccess,
  saveUserAccess
} from './user-access/api.js';
import {
  showUserAccessView,
  hideUserAccessView
} from './user-access/tree-view.js';

export {
  showUserAccessView,
  hideUserAccessView,
  loadLibraryTreeAndUserAccess,
  renderLibraryAccessTree,
  bubbleUncheck,
  createTreeNode,
  toggleAllAccess,
  saveUserAccess
};

state.showUserAccessView = showUserAccessView;
state.hideUserAccessView = hideUserAccessView;
state.loadLibraryTreeAndUserAccess = loadLibraryTreeAndUserAccess;
state.renderLibraryAccessTree = renderLibraryAccessTree;
state.bubbleUncheck = bubbleUncheck;
state.createTreeNode = createTreeNode;
state.toggleAllAccess = toggleAllAccess;
state.saveUserAccess = saveUserAccess;

if (typeof window !== 'undefined') {
  window.showUserAccessView = showUserAccessView;
  window.hideUserAccessView = hideUserAccessView;
  window.loadLibraryTreeAndUserAccess = loadLibraryTreeAndUserAccess;
  window.renderLibraryAccessTree = renderLibraryAccessTree;
  window.bubbleUncheck = bubbleUncheck;
  window.createTreeNode = createTreeNode;
  window.toggleAllAccess = toggleAllAccess;
  window.saveUserAccess = saveUserAccess;
}
