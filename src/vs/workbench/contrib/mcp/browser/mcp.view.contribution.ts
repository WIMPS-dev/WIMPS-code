/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from '../../../../platform/product/common/product.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { McpServersViewsContribution } from './mcpServersView.js';

if (!product.wimpsWorkbench?.pruneUnwiredSurfaces) {
	registerWorkbenchContribution2(McpServersViewsContribution.ID, McpServersViewsContribution, WorkbenchPhase.AfterRestored);
}
