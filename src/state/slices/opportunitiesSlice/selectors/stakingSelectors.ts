import { createSelector } from '@reduxjs/toolkit'
import type { AccountId, AssetId } from '@shapeshiftoss/caip'
import { fromAssetId } from '@shapeshiftoss/caip'
import type { AssetWithBalance } from 'features/defi/components/Overview/Overview'
import chain from 'lodash/chain'
import pickBy from 'lodash/pickBy'
import sumBy from 'lodash/sumBy'
import uniqBy from 'lodash/uniqBy'
import { bn, bnOrZero } from 'lib/bignumber/bignumber'
import { fromBaseUnit } from 'lib/math'
import { isSome, isToken } from 'lib/utils'
import type { ReduxState } from 'state/reducer'
import { createDeepEqualOutputSelector } from 'state/selector-utils'
import {
  selectAccountIdParamFromFilter,
  selectStakingIdParamFromFilter,
  selectUserStakingIdParamFromFilter,
} from 'state/selectors'

import { selectAssets } from '../../assetsSlice/selectors'
import { selectPortfolioAssetBalances, selectWalletAccountIds } from '../../common-selectors'
import { selectMarketDataSortedByMarketCap } from '../../marketDataSlice/selectors'
import { LP_EARN_OPPORTUNITIES, STAKING_EARN_OPPORTUNITIES } from '../constants'
import type {
  GroupedEligibleOpportunityReturnType,
  OpportunityId,
  OpportunityMetadata,
  StakingEarnOpportunityType,
  StakingId,
  UserStakingId,
  UserStakingOpportunity,
} from '../types'
import { deserializeUserStakingId, filterUserStakingIdByStakingIdCompareFn } from '../utils'

export const selectStakingIds = (state: ReduxState) => state.opportunities.staking.ids

export const selectUserStakingIds = createDeepEqualOutputSelector(
  selectWalletAccountIds,
  (state: ReduxState) => state.opportunities.userStaking.ids,
  (walletAccountIds, userStakingIds): UserStakingId[] =>
    userStakingIds.filter(userStakingId =>
      walletAccountIds.includes(deserializeUserStakingId(userStakingId as UserStakingId)[0]),
    ),
)

export const selectStakingOpportunitiesByAccountId = (state: ReduxState) =>
  state.opportunities.staking.byAccountId

export const selectUserStakingOpportunitiesById = createSelector(
  selectWalletAccountIds,
  (state: ReduxState) => state.opportunities.userStaking.byId,
  (walletAccountIds, userStakingById) =>
    pickBy(userStakingById, (_userStaking, userStakingId) =>
      walletAccountIds.includes(deserializeUserStakingId(userStakingId as UserStakingId)[0]),
    ),
)
export const selectStakingOpportunitiesById = (state: ReduxState) =>
  state.opportunities.staking.byId

export const selectStakingAccountIds = createDeepEqualOutputSelector(
  selectStakingOpportunitiesByAccountId,
  (byAccountId): AccountId[] => Object.keys(byAccountId),
)

// "Give me all the staking opportunities this AccountId has", so I can get their metadata and their data from the slice
export const selectStakingOpportunityIdsByAccountId = createDeepEqualOutputSelector(
  selectStakingOpportunitiesByAccountId,
  selectAccountIdParamFromFilter,
  (stakingIdsByAccountId, accountId): StakingId[] => {
    if (!accountId) return []

    return stakingIdsByAccountId[accountId] ?? []
  },
)

export const selectDeserializedStakingIdFromUserStakingIdParam = createSelector(
  selectUserStakingIdParamFromFilter,
  (userStakingId): StakingId => {
    if (!userStakingId) return '*' // Narrowing flavoured template litteral type

    const parts = deserializeUserStakingId(userStakingId)
    const [, stakingId] = parts
    return stakingId
  },
)

// "How much this specific account has staked on that opportunity"
export const selectUserStakingOpportunityByUserStakingId = createDeepEqualOutputSelector(
  selectUserStakingOpportunitiesById,
  selectUserStakingIdParamFromFilter,
  selectDeserializedStakingIdFromUserStakingIdParam,
  selectStakingOpportunitiesById,
  (
    userStakingOpportunities,
    userStakingId,
    stakingId,
    stakingOpportunities,
  ): (UserStakingOpportunity & OpportunityMetadata) | undefined => {
    if (!userStakingId) return // Narrowing flavoured template litteral type

    const userOpportunity = userStakingOpportunities[userStakingId]
    const opportunityMetadata = stakingOpportunities[stakingId]

    if (!opportunityMetadata) return

    return {
      // Overwritten by userOpportunity if it exists, else we keep defaulting to 0
      stakedAmountCryptoBaseUnit: '0',
      rewardsAmountsCryptoBaseUnit: (opportunityMetadata.rewardAssetIds?.map(() => '0') ?? []) as
        | []
        | [string, string]
        | [string],
      ...userOpportunity,
      ...opportunityMetadata,
    }
  },
)

// "Give me the staking values of all my accounts for that specific opportunity"
export const selectUserStakingOpportunitiesByStakingId = createDeepEqualOutputSelector(
  selectUserStakingOpportunitiesById,
  selectUserStakingIds,
  selectStakingOpportunitiesById,
  selectStakingIds,
  (
    userStakingOpportunities,
    userStakingOpportunityIds,
    stakingOpportunities,
    stakingIds,
  ): Record<
    StakingId,
    (OpportunityMetadata & UserStakingOpportunity & { userStakingId: `${string}*${string}` })[]
  > =>
    stakingIds.reduce<
      Record<
        StakingId,
        (OpportunityMetadata & UserStakingOpportunity & { userStakingId: `${string}*${string}` })[]
      >
    >((acc, stakingId) => {
      if (!stakingId) return acc
      // Filter out only the user data for this specific opportunity
      const filteredUserStakingOpportunityIds = userStakingOpportunityIds.filter(userStakingId =>
        filterUserStakingIdByStakingIdCompareFn(userStakingId, stakingId),
      )

      if (!userStakingOpportunityIds.length) {
        acc[stakingId] = []
        return acc
      }

      acc[stakingId] = filteredUserStakingOpportunityIds
        .map(userStakingId => {
          const opportunityData = userStakingOpportunities[userStakingId]
          const opportunityMetadata = stakingOpportunities[stakingId]
          if (!opportunityData || !opportunityMetadata) return undefined
          return Object.assign({}, opportunityMetadata, opportunityData, { userStakingId })
        })
        .filter(isSome)

      return acc
    }, {}),
)

// "Give me the staking values of all my accounts for that specific opportunity"
export const selectUserStakingOpportunitiesFromStakingId = createDeepEqualOutputSelector(
  selectUserStakingOpportunitiesById,
  selectStakingIdParamFromFilter,
  selectUserStakingIds,
  selectStakingOpportunitiesById,
  (
    userStakingOpportunities,
    stakingId,
    userStakingOpportunityIds,
    stakingOpportunities,
  ): (UserStakingOpportunity & OpportunityMetadata & { userStakingId: UserStakingId })[] => {
    if (!stakingId) return []
    // Filter out only the user data for this specific opportunity
    const filteredUserStakingOpportunityIds = userStakingOpportunityIds.filter(userStakingId =>
      filterUserStakingIdByStakingIdCompareFn(userStakingId, stakingId),
    )

    if (!userStakingOpportunityIds.length) return []

    return filteredUserStakingOpportunityIds
      .map(userStakingId => {
        const opportunityData = userStakingOpportunities[userStakingId]
        const opportunityMetadata = stakingOpportunities[stakingId]
        if (!opportunityData || !opportunityMetadata) return undefined
        return Object.assign({}, opportunityMetadata, opportunityData, { userStakingId })
      })
      .filter(isSome)
  },
)

const getAggregatedUserStakingOpportunityByStakingId = (
  userStakingOpportunities: (UserStakingOpportunity &
    OpportunityMetadata & { userStakingId: UserStakingId })[],
): (UserStakingOpportunity & OpportunityMetadata) | undefined => {
  if (!userStakingOpportunities?.length) return

  return userStakingOpportunities.reduce<
    (UserStakingOpportunity & OpportunityMetadata) | undefined
  >((acc, userStakingOpportunity) => {
    const { userStakingId, ...userStakingOpportunityWithoutUserStakingId } = userStakingOpportunity // It makes sense to have it when we have a collection, but becomes useless when aggregated

    return {
      ...userStakingOpportunityWithoutUserStakingId,
      stakedAmountCryptoBaseUnit: bnOrZero(acc?.stakedAmountCryptoBaseUnit)
        .plus(userStakingOpportunity.stakedAmountCryptoBaseUnit)
        .toString(),
      rewardsAmountsCryptoBaseUnit: (userStakingOpportunity.rewardsAmountsCryptoBaseUnit ?? []).map(
        (amount, i) => bnOrZero(acc?.rewardsAmountsCryptoBaseUnit?.[i]).plus(amount).toString(),
      ) as [string, string] | [string] | [],
    }
  }, undefined)
}

// "Give me the total values over all my accounts aggregated into one for that specific opportunity"
export const selectAggregatedUserStakingOpportunityByStakingId = createDeepEqualOutputSelector(
  selectUserStakingOpportunitiesByStakingId,
  selectStakingIdParamFromFilter,
  (
    userStakingOpportunitiesById,
    stakingId,
  ): (UserStakingOpportunity & OpportunityMetadata) | undefined => {
    if (!stakingId) return

    const userStakingOpportunities = userStakingOpportunitiesById[stakingId]

    return getAggregatedUserStakingOpportunityByStakingId(userStakingOpportunities)
  },
)

export const selectAggregatedEarnUserStakingOpportunityByStakingId = createDeepEqualOutputSelector(
  selectAggregatedUserStakingOpportunityByStakingId,
  selectMarketDataSortedByMarketCap,
  selectAssets,
  (opportunity, marketData, assets): StakingEarnOpportunityType | undefined =>
    opportunity &&
    Object.assign({}, STAKING_EARN_OPPORTUNITIES[opportunity.assetId], opportunity, {
      chainId: fromAssetId(opportunity.assetId).chainId,
      fiatAmount: bnOrZero(opportunity.stakedAmountCryptoBaseUnit)
        .times(marketData[opportunity.underlyingAssetId as AssetId]?.price ?? '0')
        .toString(),
      isLoaded: true,
      icons: opportunity.underlyingAssetIds
        .map(assetId => assets[assetId]?.icon)
        .map(icon => icon ?? ''),
      opportunityName: opportunity.name,
    }),
)

// "Give me the total values over all my accounts aggregated into one for each opportunity"
// TODO: testme
export const selectAggregatedUserStakingOpportunities = createDeepEqualOutputSelector(
  selectUserStakingOpportunitiesByStakingId,
  (userStakingOpportunitiesByStakingId): (UserStakingOpportunity & OpportunityMetadata)[] =>
    Object.values(userStakingOpportunitiesByStakingId)
      .filter(isSome)
      .map(getAggregatedUserStakingOpportunityByStakingId)
      .filter(isSome),
)

// The same as selectAggregatedUserStakingOpportunities, but parsed as an EarnOpportunityType
// TODO: testme
export const selectAggregatedEarnUserStakingOpportunities = createDeepEqualOutputSelector(
  selectAggregatedUserStakingOpportunities,
  selectMarketDataSortedByMarketCap,
  selectAssets,
  (aggregatedUserStakingOpportunities, marketData, assets): StakingEarnOpportunityType[] =>
    aggregatedUserStakingOpportunities.map(opportunity => {
      const asset = assets[opportunity.assetId]
      const underlyingAsset = assets[opportunity.underlyingAssetId]

      return Object.assign(
        {},
        isToken(fromAssetId(opportunity.underlyingAssetId).assetReference)
          ? {
              // TODO: The guts of getting contractAddress for Idle
              // ETH/FOX opportunities contractAddress will be overwritten by STAKING_EARN_OPPORTUNITIES
              // Can we generalize this? This is getting messy
              contractAddress: fromAssetId(opportunity.underlyingAssetId).assetReference,
            }
          : {},
        STAKING_EARN_OPPORTUNITIES[opportunity.assetId],
        opportunity,
        {
          chainId: fromAssetId(opportunity.assetId).chainId,
          cryptoAmountPrecision: bnOrZero(opportunity.stakedAmountCryptoBaseUnit)
            .div(bn(10).pow(asset?.precision ?? underlyingAsset?.precision ?? 1))
            .toFixed(),
          cryptoAmountBaseUnit: opportunity.stakedAmountCryptoBaseUnit,
          fiatAmount: bnOrZero(opportunity.stakedAmountCryptoBaseUnit)
            .times(marketData[asset?.assetId ?? underlyingAsset?.assetId ?? '']?.price ?? '0')
            .div(bn(10).pow(asset?.precision ?? underlyingAsset?.precision ?? 1))
            .toString(),
          isLoaded: true,
          icons: opportunity.underlyingAssetIds
            .map(assetId => assets[assetId]?.icon)
            .map(icon => icon ?? ''),
          opportunityName: opportunity.name,
        },
      )
    }),
)

export const selectAggregatedEarnUserStakingOpportunitiesIncludeEmpty =
  createDeepEqualOutputSelector(
    selectAggregatedEarnUserStakingOpportunities,
    selectStakingOpportunitiesById,
    selectAssets,
    (
      aggregatedEarnUserStakingOpportunities,
      stakingOpportunitiesById,
      assets,
    ): StakingEarnOpportunityType[] => {
      const emptyEarnOpportunitiesTypes = Object.values(stakingOpportunitiesById)
        .filter(isSome)
        .reduce((acc, opportunity) => {
          const earnOpportunity = Object.assign(
            {},
            isToken(fromAssetId(opportunity.underlyingAssetId).assetReference)
              ? {
                  // TODO: The guts of getting contractAddress for Idle
                  // ETH/FOX opportunities contractAddress will be overwritten by STAKING_EARN_OPPORTUNITIES
                  // Can we generalize this? This is getting messy
                  contractAddress: fromAssetId(opportunity.underlyingAssetId).assetReference,
                }
              : {},
            STAKING_EARN_OPPORTUNITIES[opportunity.assetId],
            opportunity,
            {
              chainId: fromAssetId(opportunity.assetId).chainId,
              cryptoAmountBaseUnit: '0',
              fiatAmount: '0',
              isLoaded: true,
              icons: opportunity.underlyingAssetIds
                .map(assetId => assets[assetId]?.icon)
                .map(icon => icon ?? ''),
              opportunityName: opportunity.name,
            },
          )

          acc.push(earnOpportunity)

          return acc
        }, [] as StakingEarnOpportunityType[])

      // Keep only the version with actual data if it exists, else keep the zero'd out version
      const aggregatedEarnUserStakingOpportunitiesIncludeEmpty = uniqBy(
        [...aggregatedEarnUserStakingOpportunities, ...emptyEarnOpportunitiesTypes],
        ({ contractAddress, assetId }) => contractAddress ?? assetId,
      )

      return aggregatedEarnUserStakingOpportunitiesIncludeEmpty.filter(opportunity => {
        if (opportunity?.expired) {
          return (
            bnOrZero(opportunity.stakedAmountCryptoBaseUnit).gt(0) ||
            opportunity?.rewardsAmountsCryptoBaseUnit?.some(rewardsAmount =>
              bnOrZero(rewardsAmount).gt(0),
            )
          )
        }

        return true
      })
    },
  )

// All opportunities, across all accounts, aggregated into one
// TODO: testme
export const selectAggregatedEarnUserStakingOpportunity = createDeepEqualOutputSelector(
  selectAggregatedEarnUserStakingOpportunities,
  selectAssets,
  (earnOpportunities, assets): StakingEarnOpportunityType | undefined =>
    earnOpportunities.reduce<StakingEarnOpportunityType | undefined>((acc, currentOpportunity) => {
      const asset = assets[currentOpportunity.assetId]
      const underlyingAsset = assets[currentOpportunity.underlyingAssetId]

      return Object.assign({}, acc, currentOpportunity, {
        cryptoAmountBaseUnit: bnOrZero(currentOpportunity.stakedAmountCryptoBaseUnit)
          .plus(acc?.stakedAmountCryptoBaseUnit ?? 0)
          .div(bn(10).pow(asset?.precision ?? underlyingAsset?.precision ?? 1))
          .toString(),
        fiatAmount: bnOrZero(currentOpportunity?.rewardsAmountsCryptoBaseUnit?.[0])
          .plus(acc?.rewardsAmountsCryptoBaseUnit?.[0] ?? 0)
          .div(bn(10).pow(asset?.precision ?? underlyingAsset?.precision ?? 1))
          .toString(),
        stakedAmountCryptoBaseUnit: bnOrZero(currentOpportunity.stakedAmountCryptoBaseUnit)
          .plus(acc?.stakedAmountCryptoBaseUnit ?? 0)
          .toString(),
      })
    }, undefined),
)

// A staking opportunity parsed as an EarnOpportunityType
// TODO: testme
export const selectEarnUserStakingOpportunityByUserStakingId = createDeepEqualOutputSelector(
  selectUserStakingOpportunityByUserStakingId,
  selectMarketDataSortedByMarketCap,
  selectAssets,
  (userStakingOpportunity, marketData, assets): StakingEarnOpportunityType | undefined => {
    if (!userStakingOpportunity || !marketData) return

    const asset = assets[userStakingOpportunity.assetId]
    const underlyingAsset = assets[userStakingOpportunity.underlyingAssetId]

    const marketDataPrice = marketData[asset?.assetId ?? underlyingAsset?.assetId ?? '']?.price

    return {
      ...LP_EARN_OPPORTUNITIES[userStakingOpportunity.assetId ?? ''],
      ...userStakingOpportunity,
      chainId: fromAssetId(userStakingOpportunity.assetId).chainId,
      cryptoAmountBaseUnit: userStakingOpportunity.stakedAmountCryptoBaseUnit ?? '0',
      fiatAmount: bnOrZero(userStakingOpportunity.stakedAmountCryptoBaseUnit)
        .div(bn(10).pow(bnOrZero(asset?.precision ?? underlyingAsset?.precision)))
        .times(marketDataPrice ?? '0')
        .toString(),
      stakedAmountCryptoBaseUnit: userStakingOpportunity.stakedAmountCryptoBaseUnit ?? '0',
      opportunityName: userStakingOpportunity.name,
      icons: userStakingOpportunity.underlyingAssetIds
        .map(assetId => assets[assetId]?.icon)
        .map(icon => icon ?? ''),
    }
  },
)

export const selectAggregatedEarnUserStakingEligibleOpportunities = createDeepEqualOutputSelector(
  selectAggregatedEarnUserStakingOpportunitiesIncludeEmpty,
  selectPortfolioAssetBalances,
  (aggregatedEarnUserStakingOpportunities, assetBalances): StakingEarnOpportunityType[] => {
    const eligibleOpportunities = aggregatedEarnUserStakingOpportunities.reduce<
      StakingEarnOpportunityType[]
    >((acc, opportunity) => {
      const hasBalance = opportunity.underlyingAssetIds.some(assetId =>
        bnOrZero(assetBalances[assetId]).gt(0),
      )
      const hasOpportunityBalance = bnOrZero(opportunity.fiatAmount).gt(0)
      if (hasBalance && !opportunity.expired && !hasOpportunityBalance) acc.push(opportunity)
      return acc
    }, [])
    return eligibleOpportunities
  },
)

export const selectAggregatedEarnUserStakingEligibleOpportunitiesByAssetId =
  createDeepEqualOutputSelector(
    selectAggregatedEarnUserStakingEligibleOpportunities,
    (userOpportunities): GroupedEligibleOpportunityReturnType[] => {
      const eligibleOpportunitiesGroupedByUnderlyingAssetIds = chain(userOpportunities)
        .groupBy('underlyingAssetIds')
        .map(values => {
          const netApy = sumBy(values, o => bn(o.apy).toNumber())
          const opportunityIds: OpportunityId[] = values.map(o => o.assetId as OpportunityId)
          const underlyingAssetIds = values[0].underlyingAssetIds
          return {
            underlyingAssetIds,
            netApy,
            opportunityIds,
          }
        })
        .value()
      return eligibleOpportunitiesGroupedByUnderlyingAssetIds
    },
  )

// Useful when multiple accounts are staked on the same opportunity, so we can detect the highest staked balance one
export const selectHighestBalanceAccountIdByStakingId = createSelector(
  selectUserStakingOpportunitiesById,
  selectStakingIdParamFromFilter,
  (userStakingOpportunities, stakingId): AccountId | undefined => {
    if (!stakingId) return '*' // Narrowing flavoured type

    const userStakingOpportunitiesEntries = Object.entries(userStakingOpportunities) as [
      UserStakingId,
      UserStakingOpportunity,
    ][]
    const foundEntry = (userStakingOpportunitiesEntries ?? [])
      .filter(([userStakingId]) =>
        filterUserStakingIdByStakingIdCompareFn(userStakingId, stakingId),
      )
      .sort(([, userStakingOpportunityA], [, userStakingOpportunityB]) =>
        bnOrZero(userStakingOpportunityB.stakedAmountCryptoBaseUnit)
          .minus(userStakingOpportunityA.stakedAmountCryptoBaseUnit)
          .toNumber(),
      )?.[0]

    const foundUserStakingId = foundEntry?.[0]

    if (!foundUserStakingId) return undefined

    const [foundAccountId] = deserializeUserStakingId(foundUserStakingId)

    return foundAccountId
  },
)

export const selectUnderlyingStakingAssetsWithBalancesAndIcons = createSelector(
  selectUserStakingOpportunityByUserStakingId,
  selectAssets,
  (userStakingOpportunity, assets): AssetWithBalance[] | undefined => {
    if (!userStakingOpportunity) return

    const asset = assets[userStakingOpportunity.assetId]
    const underlyingAsset = assets[userStakingOpportunity.underlyingAssetId]

    const underlyingAssetsIcons = userStakingOpportunity.underlyingAssetIds
      .map(assetId => assets[assetId]?.icon)
      .filter(isSome)
    return userStakingOpportunity.underlyingAssetIds
      .map((assetId, i, original) => {
        const underlyingAssetIteratee = assets[assetId]
        return underlyingAssetIteratee
          ? {
              ...underlyingAssetIteratee,
              cryptoBalancePrecision: bnOrZero(userStakingOpportunity.stakedAmountCryptoBaseUnit)
                .times(
                  fromBaseUnit(
                    userStakingOpportunity.underlyingAssetRatiosBaseUnit[i],
                    underlyingAssetIteratee.precision,
                  ) ?? '1',
                )
                .div(bn(10).pow(asset?.precision ?? underlyingAsset?.precision ?? 1))
                .toFixed(),
              icons: [underlyingAssetsIcons[i]],
              allocationPercentage: bn('1').div(original.length).toString(),
            }
          : undefined
      })
      .filter(isSome)
  },
)