import {
  DestinyVendorSaleItemComponent,
  DestinyVendorItemDefinition,
  BungieMembershipType
} from 'bungie-api-ts/destiny2';
import { loadingTracker } from '../shell/loading-tracker';
import { handleD2Errors } from './d2-trackerErrorHandler';
import { D2Store } from '../inventory/store-types';
import { dtrFetch, dtrTextReviewMultiplier } from './dtr-service-helper';
import {
  D2ItemFetchResponse,
  D2ItemFetchRequest,
  DtrD2ActivityModes
} from '../item-review/d2-dtr-api-types';
import { getVendorItemList, getItemList } from './d2-itemListBuilder';
import * as _ from 'lodash';
import store from '../store/store';
import { updateRatings } from '../item-review/actions';
import { DtrRating } from '../item-review/dtr-api-types';
import { getD2Roll } from './d2-itemTransformer';

function getBulkFetchPromise(
  stores: D2Store[],
  platformSelection: number,
  mode: DtrD2ActivityModes
): Promise<D2ItemFetchResponse[]> {
  if (!stores.length) {
    return Promise.resolve<D2ItemFetchResponse[]>([]);
  }

  const itemList = getItemList(stores);
  return getBulkItems(itemList, platformSelection, mode);
}

function getVendorBulkFetchPromise(
  platformSelection: number,
  mode: DtrD2ActivityModes,
  vendorSaleItems?: DestinyVendorSaleItemComponent[],
  vendorItems?: DestinyVendorItemDefinition[]
): Promise<D2ItemFetchResponse[]> {
  if ((vendorSaleItems && !vendorSaleItems.length) || (vendorItems && !vendorItems.length)) {
    return Promise.resolve<D2ItemFetchResponse[]>([]);
  }

  const vendorDtrItems = getVendorItemList(vendorSaleItems, vendorItems);
  return getBulkItems(vendorDtrItems, platformSelection, mode);
}

export async function getBulkItems(
  itemList: D2ItemFetchRequest[],
  platformSelection: number,
  mode: DtrD2ActivityModes
): Promise<D2ItemFetchResponse[]> {
  if (!itemList.length) {
    return Promise.resolve<D2ItemFetchResponse[]>([]);
  }

  // DTR admins requested we only make requests in batches of 10, and not in parallel
  const arrayOfArrays: D2ItemFetchRequest[][] = _.chunk(itemList, 10);

  const results: D2ItemFetchResponse[] = [];

  for (const arraySlice of arrayOfArrays) {
    const promiseSlice = dtrFetch(
      `https://db-api.destinytracker.com/api/external/reviews/fetch?platform=${platformSelection}&mode=${mode}`,
      arraySlice
    ).then(handleD2Errors, handleD2Errors);

    try {
      loadingTracker.addPromise(promiseSlice);

      const result = await promiseSlice;
      results.push(...result);
    } catch (error) {
      console.error(error);
    }
  }

  return results;
}

/**
 * Fetch the DTR community scores for all weapon items found in the supplied stores.
 */
export async function bulkFetch(
  stores: D2Store[],
  platformSelection: BungieMembershipType,
  mode: DtrD2ActivityModes
) {
  const bulkRankings = await getBulkFetchPromise(stores, platformSelection, mode);
  if (bulkRankings) {
    addScores(bulkRankings);
  }
}

/**
 * Fetch the DTR community scores for all weapon items found in the supplied vendors.
 */
export async function bulkFetchVendorItems(
  platformSelection: number,
  mode: DtrD2ActivityModes,
  vendorSaleItems?: DestinyVendorSaleItemComponent[],
  vendorItems?: DestinyVendorItemDefinition[]
): Promise<void> {
  const bulkRankings = await getVendorBulkFetchPromise(
    platformSelection,
    mode,
    vendorSaleItems,
    vendorItems
  );
  if (bulkRankings) {
    return addScores(bulkRankings);
  }
}

/**
 * Add (and track) the community scores.
 */
export function addScores(bulkRankings: D2ItemFetchResponse[]) {
  if (bulkRankings && bulkRankings.length > 0) {
    const maxTotalVotes = Math.max(
      bulkRankings.reduce((max, fr) => Math.max(fr.votes.total, max), 0),
      Object.values(store.getState().reviews.ratings).reduce(
        (max, fr) => Math.max(fr.ratingCount, max),
        0
      )
    );

    const ratings = bulkRankings.map((bulkRanking) => makeRating(bulkRanking, maxTotalVotes));

    store.dispatch(updateRatings({ ratings }));
  }
}

export function roundToAtMostOneDecimal(rating: number): number {
  if (!rating) {
    return 0;
  }

  return Math.round(rating * 10) / 10;
}

function getDownvoteMultiplier(dtrRating: D2ItemFetchResponse, maxTotalVotes: number) {
  if (dtrRating.votes.total > maxTotalVotes * 0.75) {
    return 1;
  }

  if (dtrRating.votes.total > maxTotalVotes * 0.5) {
    return 1.5;
  }

  if (dtrRating.votes.total > maxTotalVotes * 0.25) {
    return 2;
  }

  return 2.5;
}

function getScore(dtrRating: D2ItemFetchResponse, maxTotalVotes: number): number {
  const downvoteMultipler = getDownvoteMultiplier(dtrRating, maxTotalVotes);

  const totalVotes = dtrRating.votes.total + dtrRating.reviewVotes.total * dtrTextReviewMultiplier;
  const totalDownVotes =
    dtrRating.votes.downvotes + dtrRating.reviewVotes.downvotes * dtrTextReviewMultiplier;

  const rating = ((totalVotes - totalDownVotes * downvoteMultipler) / totalVotes) * 5;

  if (rating < 1 && dtrRating.votes.total > 0) {
    return 1;
  }

  return roundToAtMostOneDecimal(rating);
}

function makeRating(dtrRating: D2ItemFetchResponse, maxTotalVotes: number): DtrRating {
  return {
    referenceId: dtrRating.referenceId,
    roll: getD2Roll(dtrRating.availablePerks),
    overallScore: getScore(dtrRating, maxTotalVotes),
    lastUpdated: new Date(),
    ratingCount: dtrRating.votes.total,
    highlightedRatingCount: 0 // bugbug: D2 API doesn't seem to be returning highlighted ratings in fetch
  };
}
