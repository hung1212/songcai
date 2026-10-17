// Public marksixResult query shape used by the HKJC results endpoint.
// Keep the complete fragment: shortened queries are rejected by the service.
export const HKJC_RESULTS_QUERY = `
	fragment lotteryDrawsFragment on LotteryDraw {
		id
		year
		no
		openDate
		closeDate
		drawDate
		status
		snowballCode
		snowballName_en
		snowballName_ch
		lotteryPool {
			sell
			status
			totalInvestment
			jackpot
			unitBet
			estimatedPrize
			derivedFirstPrizeDiv
			lotteryPrizes {
				type
				winningUnit
				dividend
			}
		}
		drawResult {
			drawnNo
			xDrawnNo
		}
	}

	query marksixResult(
		$lastNDraw: Int
		$startDate: String
		$endDate: String
		$drawType: LotteryDrawType
	) {
		lotteryDraws(
			lastNDraw: $lastNDraw
			startDate: $startDate
			endDate: $endDate
			drawType: $drawType
		) {
			...lotteryDrawsFragment
		}
	}
`;
